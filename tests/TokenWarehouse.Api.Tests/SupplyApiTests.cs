using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TokenWarehouse.Application;
using TokenWarehouse.Infrastructure.Persistence;
using Xunit;

namespace TokenWarehouse.Api.Tests;

public sealed class SupplyApiTests
{
    private static readonly DateTimeOffset SupplyTime =
        new(2030, 1, 15, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Records_a_supply_and_keeps_the_result_after_a_new_request()
    {
        using var factory = new SupplyHostFactory(SupplyTime);
        using var client = factory.CreateClient();
        await CreateFoodAsync(client, "0123456789012", "DLC du jour");

        using var first = await client.PostAsJsonAsync(
            "/api/supplies",
            new { ean13 = "0123456789012", quantity = 3 });

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal("application/json", first.Content.Headers.ContentType?.MediaType);
        using var firstBody = JsonDocument.Parse(await first.Content.ReadAsStringAsync());
        var operation = firstBody.RootElement.GetProperty("operation");
        Assert.Equal("supply", operation.GetProperty("type").GetString());
        Assert.Equal("0123456789012", operation.GetProperty("ean13").GetString());
        Assert.Equal(3, operation.GetProperty("quantity").GetInt32());
        Assert.Equal(SupplyTime, DateTimeOffset.Parse(operation.GetProperty("occurredAt").GetString()!));
        Assert.False(string.IsNullOrWhiteSpace(operation.GetProperty("id").GetString()));

        var position = firstBody.RootElement.GetProperty("position");
        Assert.Equal("0123456789012", position.GetProperty("ean13").GetString());
        Assert.Equal(3, position.GetProperty("physicalQuantity").GetInt32());
        Assert.Equal(3, position.GetProperty("sellableQuantity").GetInt32());

        using var second = await client.PostAsJsonAsync(
            "/api/supplies",
            new { ean13 = "0123456789012", quantity = 2 });
        Assert.Equal(HttpStatusCode.Created, second.StatusCode);
        using var secondBody = JsonDocument.Parse(await second.Content.ReadAsStringAsync());
        Assert.Equal(5, secondBody.RootElement.GetProperty("position").GetProperty("physicalQuantity").GetInt32());

        using var stock = await client.GetAsync("/api/stock/0123456789012");
        using var stockBody = JsonDocument.Parse(await stock.Content.ReadAsStringAsync());
        Assert.Equal(5, stockBody.RootElement.GetProperty("physicalQuantity").GetInt32());
        Assert.Equal(5, stockBody.RootElement.GetProperty("sellableQuantity").GetInt32());

        var facts = await ReadOperationsAsync(factory);
        Assert.Equal(2, facts.Count);
        Assert.Equal(3, facts[0].Quantity);
        Assert.Equal(2, facts[1].Quantity);
        Assert.NotEqual(facts[0].Id, facts[1].Id);
        Assert.Equal("2030-01-15T10:00:00.0000000+00:00", facts[0].OccurredAt);
    }

    [Fact]
    public async Task Rejects_strict_quantity_shapes_without_creating_stock_or_history()
    {
        using var factory = new SupplyHostFactory(SupplyTime);
        using var client = factory.CreateClient();
        await CreateFoodAsync(client, "0123456789012", "Quantité stricte");

        var payloads = new[]
        {
            "{\"ean13\":\"0123456789012\"}",
            "{\"ean13\":\"0123456789012\",\"quantity\":null}",
            "{\"ean13\":\"0123456789012\",\"quantity\":0}",
            "{\"ean13\":\"0123456789012\",\"quantity\":-1}",
            "{\"ean13\":\"0123456789012\",\"quantity\":1.5}",
            "{\"ean13\":\"0123456789012\",\"quantity\":3.0}",
            "{\"ean13\":\"0123456789012\",\"quantity\":\"3\"}"
        };

        foreach (var payload in payloads)
        {
            using var response = await client.PostAsync(
                "/api/supplies",
                new StringContent(payload, Encoding.UTF8, "application/json"));

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            Assert.True(body.RootElement.GetProperty("errors").TryGetProperty("quantity", out _), payload);
        }

        Assert.Equal(0, await ReadAsync(factory, context => context.StockPositions.CountAsync()));
        Assert.Equal(0, await ReadAsync(factory, context => context.StockOperations.CountAsync()));
    }

    [Fact]
    public async Task Distinguishes_unknown_and_archived_articles_without_partial_writes()
    {
        using var factory = new SupplyHostFactory(SupplyTime);
        using var client = factory.CreateClient();
        await CreateFoodAsync(client, "0123456789012", "Article actif");
        await CreateNonFoodAsync(client, "7351353713578", "Article archivé");
        using var archive = await client.PostAsync("/api/articles/7351353713578/archive", null);
        Assert.Equal(HttpStatusCode.OK, archive.StatusCode);

        using var unknown = await client.PostAsJsonAsync(
            "/api/supplies",
            new { ean13 = "4006381333931", quantity = 2 });
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        using var unknownBody = JsonDocument.Parse(await unknown.Content.ReadAsStringAsync());
        Assert.Equal("supply.article.not_found", unknownBody.RootElement.GetProperty("code").GetString());

        using var archived = await client.PostAsJsonAsync(
            "/api/supplies",
            new { ean13 = "7351353713578", quantity = 2 });
        Assert.Equal(HttpStatusCode.Conflict, archived.StatusCode);
        using var archivedBody = JsonDocument.Parse(await archived.Content.ReadAsStringAsync());
        Assert.Equal("article_archived", archivedBody.RootElement.GetProperty("code").GetString());

        Assert.Equal(0, await ReadAsync(factory, context => context.StockPositions.CountAsync()));
        Assert.Equal(0, await ReadAsync(factory, context => context.StockOperations.CountAsync()));
    }

    private static async Task CreateFoodAsync(HttpClient client, string ean13, string name)
    {
        using var response = await client.PostAsJsonAsync("/api/articles", new
        {
            ean13,
            type = "food",
            name,
            priceHtCents = 100,
            dlc = "2030-01-15",
            consumptionModes = new[] { "takeaway", "onsite" }
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private static async Task CreateNonFoodAsync(HttpClient client, string ean13, string name)
    {
        using var response = await client.PostAsJsonAsync("/api/articles", new
        {
            ean13,
            type = "nonFood",
            name,
            priceHtCents = 100,
            packaging = "new"
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private static async Task<List<OperationRow>> ReadOperationsAsync(SupplyHostFactory factory)
        => await ReadAsync(factory, async context => await context.StockOperations
            .AsNoTracking()
            .OrderBy(operation => operation.OccurredAt)
            .Select(operation => new OperationRow(operation.Id, operation.Quantity, operation.OccurredAt))
            .ToListAsync());

    private static async Task<T> ReadAsync<T>(
        SupplyHostFactory factory,
        Func<WarehouseDbContext, Task<T>> read)
    {
        using var scope = factory.Services.CreateScope();
        var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
        await using var context = await contextFactory.CreateDbContextAsync();
        return await read(context);
    }

    private sealed record OperationRow(string Id, int Quantity, string OccurredAt);

    private sealed class SupplyHostFactory : WebApplicationFactory<Program>
    {
        private readonly SqliteConnection connection;
        private readonly DateTimeOffset now;

        public SupplyHostFactory(DateTimeOffset now)
        {
            this.now = now;
            connection = new SqliteConnection("Data Source=:memory:");
            connection.Open();
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IDbContextFactory<WarehouseDbContext>>();
                services.RemoveAll<DbContextOptions<WarehouseDbContext>>();
                services.AddDbContextFactory<WarehouseDbContext>(options => options.UseSqlite(connection));
                services.RemoveAll<IClock>();
                services.AddSingleton<IClock>(new FixedClock(now));
            });
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (disposing)
            {
                connection.Dispose();
            }
        }
    }

    private sealed class FixedClock(DateTimeOffset now) : IClock
    {
        public DateTimeOffset UtcNow => now;
    }
}
