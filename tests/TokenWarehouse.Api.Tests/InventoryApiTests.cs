using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TokenWarehouse.Application;
using TokenWarehouse.Infrastructure.Persistence;
using Xunit;

namespace TokenWarehouse.Api.Tests;

public sealed class InventoryApiTests
{
    [Fact]
    public async Task Posts_an_inventory_and_returns_the_reconciled_position_and_operation()
    {
        using var factory = new InventoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync("0123456789012", "Article inventorié", true, 8);

        using var response = await client.PostAsJsonAsync(
            "/api/inventories",
            new { ean13 = "0123456789012", countedQuantity = 11 });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var operation = body.RootElement.GetProperty("operation");
        var position = body.RootElement.GetProperty("position");
        Assert.Equal("INVENTORY", operation.GetProperty("type").GetString());
        Assert.Equal("0123456789012", operation.GetProperty("ean13").GetString());
        Assert.Equal(8, operation.GetProperty("previousPhysicalStock").GetInt32());
        Assert.Equal(11, operation.GetProperty("countedQuantity").GetInt32());
        Assert.Equal(3, operation.GetProperty("inventoryDifference").GetInt32());
        Assert.Equal(11, operation.GetProperty("resultingPhysicalStock").GetInt32());
        Assert.Equal("2030-01-15T10:00:00+00:00", operation.GetProperty("timestampUtc").GetString());
        Assert.Equal("0123456789012", position.GetProperty("ean13").GetString());
        Assert.Equal(11, position.GetProperty("physicalStock").GetInt32());
        Assert.Equal(11, position.GetProperty("sellableStock").GetInt32());

        var operationId = operation.GetProperty("id").GetString();
        Assert.False(string.IsNullOrWhiteSpace(operationId));
        using var operationRead = await client.GetAsync($"/api/inventories/{operationId}");
        Assert.Equal(HttpStatusCode.OK, operationRead.StatusCode);
    }

    [Fact]
    public async Task Persists_a_zero_difference_and_rereads_it_after_a_fresh_context()
    {
        using var factory = new InventoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync("0123456789012", "Article écart nul", true, 8);

        using var response = await client.PostAsJsonAsync(
            "/api/inventories",
            new { ean13 = "0123456789012", countedQuantity = 8 });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var operation = body.RootElement.GetProperty("operation");
        var operationId = operation.GetProperty("id").GetString();
        Assert.Equal(8, operation.GetProperty("previousPhysicalStock").GetInt32());
        Assert.Equal(8, operation.GetProperty("countedQuantity").GetInt32());
        Assert.Equal(0, operation.GetProperty("inventoryDifference").GetInt32());
        Assert.Equal(8, operation.GetProperty("resultingPhysicalStock").GetInt32());

        using var reread = await client.GetAsync($"/api/inventories/{operationId}");
        Assert.Equal(HttpStatusCode.OK, reread.StatusCode);
        using var rereadBody = JsonDocument.Parse(await reread.Content.ReadAsStringAsync());
        Assert.Equal(0, rereadBody.RootElement.GetProperty("inventoryDifference").GetInt32());
        Assert.Equal(0, await factory.ReadInventoryDifferenceAsync(operationId!));
    }

    [Fact]
    public async Task A_second_inventory_uses_the_new_position_and_keeps_the_first_fact_unchanged()
    {
        using var factory = new InventoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync("0123456789012", "Article inventorié", true, 8);

        using var first = await client.PostAsJsonAsync(
            "/api/inventories",
            new { ean13 = "0123456789012", countedQuantity = 11 });
        using var firstBody = JsonDocument.Parse(await first.Content.ReadAsStringAsync());
        var firstOperation = firstBody.RootElement.GetProperty("operation");
        var firstId = firstOperation.GetProperty("id").GetString();

        using var second = await client.PostAsJsonAsync(
            "/api/inventories",
            new { ean13 = "0123456789012", countedQuantity = 5 });
        using var secondBody = JsonDocument.Parse(await second.Content.ReadAsStringAsync());
        var secondOperation = secondBody.RootElement.GetProperty("operation");

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.Created, second.StatusCode);
        Assert.Equal(11, secondOperation.GetProperty("previousPhysicalStock").GetInt32());
        Assert.Equal(-6, secondOperation.GetProperty("inventoryDifference").GetInt32());
        Assert.Equal(5, secondOperation.GetProperty("resultingPhysicalStock").GetInt32());

        using var firstRead = await client.GetAsync($"/api/inventories/{firstId}");
        using var firstReadBody = JsonDocument.Parse(await firstRead.Content.ReadAsStringAsync());
        Assert.Equal(8, firstReadBody.RootElement.GetProperty("previousPhysicalStock").GetInt32());
        Assert.Equal(11, firstReadBody.RootElement.GetProperty("resultingPhysicalStock").GetInt32());

        using var stockRead = await client.GetAsync("/api/stock/0123456789012");
        using var stockBody = JsonDocument.Parse(await stockRead.Content.ReadAsStringAsync());
        Assert.Equal(5, stockBody.RootElement.GetProperty("physicalQuantity").GetInt32());
    }

    [Fact]
    public async Task Accepts_zero_and_archived_articles_without_creating_a_sellable_position()
    {
        using var factory = new InventoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync("0123456789012", "Article zéro", true, 8);
        await factory.SeedArticleAsync("4006381333931", "Article archivé", false, 4);

        using var zero = await client.PostAsJsonAsync(
            "/api/inventories",
            new { ean13 = "0123456789012", countedQuantity = 0 });
        using var zeroBody = JsonDocument.Parse(await zero.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Created, zero.StatusCode);
        Assert.Equal(-8, zeroBody.RootElement.GetProperty("operation").GetProperty("inventoryDifference").GetInt32());
        Assert.Equal(0, zeroBody.RootElement.GetProperty("position").GetProperty("physicalStock").GetInt32());

        using var archived = await client.PostAsJsonAsync(
            "/api/inventories",
            new { ean13 = "4006381333931", countedQuantity = 2 });
        using var archivedBody = JsonDocument.Parse(await archived.Content.ReadAsStringAsync());
        var archivedPosition = archivedBody.RootElement.GetProperty("position");
        Assert.Equal(HttpStatusCode.Created, archived.StatusCode);
        Assert.Equal(2, archivedPosition.GetProperty("physicalStock").GetInt32());
        Assert.Equal(0, archivedPosition.GetProperty("sellableStock").GetInt32());
        Assert.Equal("NOT_SELLABLE", archivedPosition.GetProperty("availability").GetString());
        Assert.Equal("ARCHIVED", archivedPosition.GetProperty("reason").GetString());
    }

    [Theory]
    [InlineData("{\"ean13\":\"0123456789012\",\"countedQuantity\":-1}")]
    [InlineData("{\"ean13\":\"0123456789012\",\"countedQuantity\":1.5}")]
    [InlineData("{\"ean13\":\"0123456789012\",\"countedQuantity\":\"1\"}")]
    [InlineData("{\"ean13\":\"0123456789012\"}")]
    [InlineData("{\"ean13\":0123456789012,\"countedQuantity\":1}")]
    [InlineData("{\"ean13\":\"0123456789012\",\"countedQuantity\":1,\"extra\":true}")]
    public async Task Rejects_invalid_input_without_writing(
        string json)
    {
        using var factory = new InventoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync("0123456789012", "Article inventorié", true, 8);

        using var response = await client.PostAsync(
            "/api/inventories",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("INVALID_INPUT", body.RootElement.GetProperty("code").GetString());
        Assert.Equal(8, await factory.ReadPhysicalQuantityAsync("0123456789012"));
        Assert.Equal(0, await factory.CountOperationsAsync());
    }

    [Fact]
    public async Task Rejects_a_non_json_content_type_without_writing()
    {
        using var factory = new InventoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync("0123456789012", "Article inventorié", true, 8);

        using var response = await client.PostAsync(
            "/api/inventories",
            new StringContent(
                "{\"ean13\":\"0123456789012\",\"countedQuantity\":11}",
                System.Text.Encoding.UTF8,
                "text/plain"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(8, await factory.ReadPhysicalQuantityAsync("0123456789012"));
        Assert.Equal(0, await factory.CountOperationsAsync());
    }

    [Fact]
    public async Task Maps_unknown_article_and_preserves_the_initial_ean_as_a_string()
    {
        using var factory = new InventoryHostFactory();
        using var client = factory.CreateClient();

        using var response = await client.PostAsJsonAsync(
            "/api/inventories",
            new { ean13 = "4006381333931", countedQuantity = 1 });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("ARTICLE_NOT_FOUND", body.RootElement.GetProperty("code").GetString());
        Assert.Equal(0, await factory.CountOperationsAsync());
    }

    [Fact]
    public async Task At_most_one_concurrent_inventory_can_use_the_same_previous_position()
    {
        using var factory = new InventoryHostFactory();
        using var firstClient = factory.CreateClient();
        using var secondClient = factory.CreateClient();
        await factory.SeedArticleAsync("0123456789012", "Article concurrent", true, 8);

        var responses = await Task.WhenAll(
            firstClient.PostAsJsonAsync("/api/inventories", new { ean13 = "0123456789012", countedQuantity = 8 }),
            secondClient.PostAsJsonAsync("/api/inventories", new { ean13 = "0123456789012", countedQuantity = 8 }));

        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Created);
        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Conflict);
        Assert.Equal(1, await factory.CountOperationsAsync());
    }

    [Fact]
    public async Task Treats_a_race_to_create_an_absent_position_as_a_conflict()
    {
        using var factory = new InventoryHostFactory();
        using var firstClient = factory.CreateClient();
        using var secondClient = factory.CreateClient();
        await factory.SeedArticleAsync("0123456789012", "Article sans position", true, null);

        var responses = await Task.WhenAll(
            firstClient.PostAsJsonAsync("/api/inventories", new { ean13 = "0123456789012", countedQuantity = 2 }),
            secondClient.PostAsJsonAsync("/api/inventories", new { ean13 = "0123456789012", countedQuantity = 2 }));

        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Created);
        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Conflict);
        Assert.Equal(1, await factory.CountOperationsAsync());
    }

    [Fact]
    public async Task Rolls_back_real_sqlite_commit_failure_without_partial_rows()
    {
        using var factory = new InventoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync("0123456789012", "Article en panne", true, 8);
        await factory.FailInventoryOperationInsertsAsync();

        using var response = await client.PostAsJsonAsync(
            "/api/inventories",
            new { ean13 = "0123456789012", countedQuantity = 11 });

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("PERSISTENCE_FAILURE", body.RootElement.GetProperty("code").GetString());
        Assert.DoesNotContain("SQLite", body.RootElement.GetRawText(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(8, await factory.ReadPhysicalQuantityAsync("0123456789012"));
        Assert.Equal(0, await factory.CountOperationsAsync());
    }

    private sealed class InventoryHostFactory : WebApplicationFactory<Program>
    {
        private readonly string databasePath = Path.Combine(
            Path.GetTempPath(),
            $"token-warehouse-inventory-{Guid.NewGuid():N}.db");

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:Warehouse", $"Data Source={databasePath}");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IClock>();
                services.AddSingleton<IClock>(new FixedClock());
            });
        }

        public async Task SeedArticleAsync(
            string ean13,
            string name,
            bool isActive,
            int? physicalQuantity)
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            context.Articles.Add(new ArticleEntity
            {
                Ean13 = ean13,
                Type = "food",
                Name = name,
                NameSearchKey = name.ToUpperInvariant(),
                PriceHtCents = 100,
                IsActive = isActive,
                Dlc = "2030-01-15",
                ConsumptionModes = "takeaway"
            });
            if (physicalQuantity is { } quantity)
            {
                context.StockPositions.Add(new StockPositionEntity
                {
                    Ean13 = ean13,
                    PhysicalQuantity = quantity
                });
            }

            await context.SaveChangesAsync();
        }

        public async Task FailInventoryOperationInsertsAsync()
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            await context.Database.ExecuteSqlRawAsync(
                """
                CREATE TRIGGER FailInventoryOperationInsert
                BEFORE INSERT ON StockOperations
                BEGIN
                    SELECT RAISE(ABORT, 'controlled inventory failure');
                END;
                """);
        }

        public async Task<int> ReadPhysicalQuantityAsync(string ean13)
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            return await context.StockPositions
                .Where(position => position.Ean13 == ean13)
                .Select(position => position.PhysicalQuantity)
                .SingleAsync();
        }

        public async Task<int> CountOperationsAsync()
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            return await context.StockOperations.CountAsync();
        }

        public async Task<int> ReadInventoryDifferenceAsync(string operationId)
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            return await context.StockOperations
                .Where(operation => operation.Id == operationId)
                .Select(operation => operation.InventoryDifference)
                .SingleAsync();
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (disposing)
            {
                File.Delete(databasePath);
                File.Delete($"{databasePath}-shm");
                File.Delete($"{databasePath}-wal");
            }
        }
    }

    private sealed class FixedClock : IClock
    {
        public DateTimeOffset UtcNow => new(2030, 1, 15, 10, 0, 0, TimeSpan.Zero);
    }

}
