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
using TokenWarehouse.Domain;
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
    public async Task Returns_physical_stock_and_policy_reason_for_active_non_sellable_articles()
    {
        using var factory = new SupplyHostFactory(SupplyTime);
        using var client = factory.CreateClient();
        await CreateFoodAsync(client, "0123456789012", "Article expiré", "2030-01-14");
        await CreateNonFoodAsync(client, "4006381333931", "Packaging invendable", "unsellable");

        using var expired = await client.PostAsJsonAsync(
            "/api/supplies",
            new { ean13 = "0123456789012", quantity = 2 });
        using var expiredBody = JsonDocument.Parse(await expired.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Created, expired.StatusCode);
        Assert.Equal(2, expiredBody.RootElement.GetProperty("position").GetProperty("physicalQuantity").GetInt32());
        Assert.Equal(0, expiredBody.RootElement.GetProperty("position").GetProperty("sellableQuantity").GetInt32());
        Assert.Equal("DLC_EXPIRED", expiredBody.RootElement.GetProperty("position").GetProperty("reason").GetString());

        using var unsellable = await client.PostAsJsonAsync(
            "/api/supplies",
            new { ean13 = "4006381333931", quantity = 3 });
        using var unsellableBody = JsonDocument.Parse(await unsellable.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Created, unsellable.StatusCode);
        Assert.Equal(3, unsellableBody.RootElement.GetProperty("position").GetProperty("physicalQuantity").GetInt32());
        Assert.Equal(0, unsellableBody.RootElement.GetProperty("position").GetProperty("sellableQuantity").GetInt32());
        Assert.Equal("UNSELLABLE_PACKAGING", unsellableBody.RootElement.GetProperty("position").GetProperty("reason").GetString());
    }

    [Fact]
    public async Task Rolls_back_the_position_when_operation_persistence_fails()
    {
        using var factory = new SupplyHostFactory(SupplyTime);
        using var client = factory.CreateClient();
        await CreateFoodAsync(client, "0123456789012", "Article transactionnel");

        using var first = await client.PostAsJsonAsync(
            "/api/supplies",
            new { ean13 = "0123456789012", quantity = 4 });
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        var existingOperation = Assert.Single(await ReadOperationsAsync(factory));

        using (var scope = factory.Services.CreateScope())
        {
            var articleReader = scope.ServiceProvider.GetRequiredService<IArticleSellabilityReader>();
            var stockReader = scope.ServiceProvider.GetRequiredService<IStockPositionReader>();
            var committer = scope.ServiceProvider.GetRequiredService<ISupplyCommitter>();
            var ean13 = AssertEan("0123456789012");
            var article = await articleReader.FindSellabilityByEanAsync(ean13);
            var current = await stockReader.FindByEanAsync(ean13);
            Assert.NotNull(article);
            Assert.NotNull(current);
            Assert.True(Quantity.TryCreatePositive(2, out var quantity));

            var result = await committer.CommitAsync(new SupplyCommitRequest(
                article!,
                current,
                current!.Add(quantity),
                StockOperation.CreateSupply(existingOperation.Id, ean13, quantity, SupplyTime)));

            Assert.Equal(SupplyCommitStatus.Conflict, result.Status);
        }

        Assert.Equal(
            4,
            await ReadAsync(factory, context => context.StockPositions
                .Where(position => position.Ean13 == "0123456789012")
                .Select(position => position.PhysicalQuantity)
                .SingleAsync()));
        Assert.Single(await ReadOperationsAsync(factory));
    }

    [Fact]
    public async Task Concurrent_supplies_do_not_lose_an_accepted_update()
    {
        using var commitBarrier = new Barrier(2);
        using var factory = new SupplyHostFactory(SupplyTime, supplyCommitBarrier: commitBarrier);
        using var client = factory.CreateClient();
        await CreateFoodAsync(client, "0123456789012", "Article concurrent");

        var responses = await Task.WhenAll(
            new[] { 2, 3 }.Select(quantity => client.PostAsJsonAsync(
                "/api/supplies",
                new { ean13 = "0123456789012", quantity })));

        try
        {
            var committedQuantities = new List<int>();
            foreach (var response in responses)
            {
                Assert.True(
                    response.StatusCode is HttpStatusCode.Created or HttpStatusCode.Conflict,
                    $"Unexpected status: {(int)response.StatusCode}");
                if (response.StatusCode == HttpStatusCode.Created)
                {
                    using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
                    committedQuantities.Add(body.RootElement.GetProperty("operation").GetProperty("quantity").GetInt32());
                }
            }

            Assert.NotEmpty(committedQuantities);
            Assert.Equal(
                committedQuantities.Sum(),
                await ReadAsync(factory, context => context.StockPositions
                    .Where(position => position.Ean13 == "0123456789012")
                    .Select(position => position.PhysicalQuantity)
                    .SingleAsync()));
            Assert.Equal(committedQuantities.Count, (await ReadOperationsAsync(factory)).Count);
        }
        finally
        {
            foreach (var response in responses)
            {
                response.Dispose();
            }
        }
    }

    [Fact]
    public async Task Supply_operation_survives_a_file_reopen()
    {
        var filePath = Path.Combine(Path.GetTempPath(), $"token-warehouse-supply-{Guid.NewGuid():N}.db");
        string? operationId;

        try
        {
            using (var factory = new SupplyHostFactory(SupplyTime, filePath))
            using (var client = factory.CreateClient())
            {
                await CreateFoodAsync(client, "0123456789012", "Article durable");
                using var response = await client.PostAsJsonAsync(
                    "/api/supplies",
                    new { ean13 = "0123456789012", quantity = 3 });
                Assert.Equal(HttpStatusCode.Created, response.StatusCode);
                using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
                operationId = body.RootElement.GetProperty("operation").GetProperty("id").GetString();
            }

            using (var reopenedFactory = new SupplyHostFactory(SupplyTime, filePath))
            using (var reopenedClient = reopenedFactory.CreateClient())
            {
                using var stock = await reopenedClient.GetAsync("/api/stock/0123456789012");
                using var stockBody = JsonDocument.Parse(await stock.Content.ReadAsStringAsync());
                Assert.Equal(HttpStatusCode.OK, stock.StatusCode);
                Assert.Equal(3, stockBody.RootElement.GetProperty("physicalQuantity").GetInt32());

                var facts = await ReadOperationsAsync(reopenedFactory);
                Assert.Equal(operationId, Assert.Single(facts).Id);
                Assert.Equal("2030-01-15T10:00:00.0000000+00:00", facts[0].OccurredAt);
            }
        }
        finally
        {
            File.Delete(filePath);
            File.Delete($"{filePath}-shm");
            File.Delete($"{filePath}-wal");
        }
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

        var invalidEanPayloads = new[]
        {
            "{\"ean13\":\"012345678901\",\"quantity\":1}",
            "{\"ean13\":\"0123456789013\",\"quantity\":1}",
            "{\"ean13\":\"01234567890A2\",\"quantity\":1}"
        };

        foreach (var payload in invalidEanPayloads)
        {
            using var response = await client.PostAsync(
                "/api/supplies",
                new StringContent(payload, Encoding.UTF8, "application/json"));

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            Assert.True(body.RootElement.GetProperty("errors").TryGetProperty("ean13", out _), payload);
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

    private static async Task CreateFoodAsync(
        HttpClient client,
        string ean13,
        string name,
        string dlc = "2030-01-15")
    {
        using var response = await client.PostAsJsonAsync("/api/articles", new
        {
            ean13,
            type = "food",
            name,
            priceHtCents = 100,
            dlc,
            consumptionModes = new[] { "takeaway", "onsite" }
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private static async Task CreateNonFoodAsync(
        HttpClient client,
        string ean13,
        string name,
        string packaging = "new")
    {
        using var response = await client.PostAsJsonAsync("/api/articles", new
        {
            ean13,
            type = "nonFood",
            name,
            priceHtCents = 100,
            packaging
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

    private static Ean13 AssertEan(string value)
    {
        Assert.True(Ean13.TryCreate(value, out var ean13));
        return ean13;
    }

    private sealed class SupplyHostFactory : WebApplicationFactory<Program>
    {
        private readonly string connectionString;
        private readonly SqliteConnection keeperConnection;
        private readonly DateTimeOffset now;
        private readonly Barrier? supplyCommitBarrier;

        public SupplyHostFactory(
            DateTimeOffset now,
            string? databasePath = null,
            Barrier? supplyCommitBarrier = null)
        {
            this.now = now;
            this.supplyCommitBarrier = supplyCommitBarrier;
            connectionString = databasePath is null
                ? $"Data Source=file:token-warehouse-{Guid.NewGuid():N};Mode=Memory;Cache=Shared"
                : $"Data Source={databasePath}";
            keeperConnection = new SqliteConnection(connectionString);
            keeperConnection.Open();
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IDbContextFactory<WarehouseDbContext>>();
                services.RemoveAll<DbContextOptions<WarehouseDbContext>>();
                services.AddDbContextFactory<WarehouseDbContext>(options => options.UseSqlite(connectionString));
                services.RemoveAll<IClock>();
                services.AddSingleton<IClock>(new FixedClock(now));
                if (supplyCommitBarrier is not null)
                {
                    services.RemoveAll<ISupplyCommitter>();
                    services.AddScoped<ISupplyCommitter>(serviceProvider => new GatedSupplyCommitter(
                        new SqliteSupplyCommitter(
                            serviceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>()),
                        supplyCommitBarrier));
                }
            });
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (disposing)
            {
                keeperConnection.Dispose();
            }
        }
    }

    private sealed class GatedSupplyCommitter(
        ISupplyCommitter inner,
        Barrier barrier) : ISupplyCommitter
    {
        public async ValueTask<SupplyCommitResult> CommitAsync(
            SupplyCommitRequest request,
            CancellationToken cancellationToken = default)
        {
            barrier.SignalAndWait(TimeSpan.FromSeconds(10), cancellationToken);
            return await inner.CommitAsync(request, cancellationToken);
        }
    }

    private sealed class FixedClock(DateTimeOffset now) : IClock
    {
        public DateTimeOffset UtcNow => now;
    }
}
