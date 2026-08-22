using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TokenWarehouse.Infrastructure.Persistence;
using Xunit;

namespace TokenWarehouse.Api.Tests;

public sealed class HistoryApiTests
{
    [Fact]
    public async Task Merges_stock_and_catalogue_facts_in_deterministic_order_and_filters_bulk_lines()
    {
        using var factory = new HistoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedAsync();
        var before = await factory.CountAsync();

        using var response = await client.GetAsync("/api/history");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(4, body.RootElement.GetArrayLength());
        Assert.Equal("COUNTER_MOVEMENT", body.RootElement[0].GetProperty("type").GetString());
        Assert.Equal("counter-0004", body.RootElement[0].GetProperty("id").GetString());
        Assert.Equal("bulk-0002", body.RootElement[0].GetProperty("sourceOperationId").GetString());
        Assert.Equal("Correction de contrôle", body.RootElement[0].GetProperty("justification").GetString());
        Assert.Equal("CATALOG_ARCHIVE", body.RootElement[1].GetProperty("type").GetString());
        Assert.Equal("INVENTORY", body.RootElement[2].GetProperty("type").GetString());
        Assert.Equal(5, body.RootElement[2].GetProperty("countedQuantity").GetInt32());
        Assert.Equal(0, body.RootElement[2].GetProperty("difference").GetInt32());
        Assert.Equal("bulk-0002", body.RootElement[3].GetProperty("id").GetString());

        using var filtered = await client.GetAsync("/api/history?ean13=0123456789012");
        using var filteredBody = JsonDocument.Parse(await filtered.Content.ReadAsStringAsync());
        var bulk = filteredBody.RootElement.EnumerateArray()
            .Single(entry => entry.GetProperty("id").GetString() == "bulk-0002");
        Assert.Equal(1, bulk.GetProperty("lines").GetArrayLength());
        Assert.Equal("0123456789012", bulk.GetProperty("lines")[0].GetProperty("ean13").GetString());
        Assert.DoesNotContain(
            filteredBody.RootElement.EnumerateArray(),
            entry => entry.GetProperty("articles").EnumerateArray().Any(article => article.GetProperty("ean13").GetString() == "7351353713578"));

        using var unknown = await client.GetAsync("/api/history?ean13=4006381333931");
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        using var unknownBody = JsonDocument.Parse(await unknown.Content.ReadAsStringAsync());
        Assert.Equal("ARTICLE_NOT_FOUND", unknownBody.RootElement.GetProperty("code").GetString());

        using var invalid = await client.GetAsync("/api/history?ean13=not-an-ean");
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        using var invalidBody = JsonDocument.Parse(await invalid.Content.ReadAsStringAsync());
        Assert.Equal("INVALID_EAN13", invalidBody.RootElement.GetProperty("code").GetString());

        Assert.Equal(before, await factory.CountAsync());
    }

    [Fact]
    public async Task Returns_an_empty_collection_for_a_known_article_without_history()
    {
        using var factory = new HistoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync("0123456789012");

        using var response = await client.GetAsync("/api/history?ean13=0123456789012");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Empty(body.RootElement.EnumerateArray());
    }

    [Fact]
    public async Task Reads_the_committed_resulting_stock_of_a_supply()
    {
        using var factory = new HistoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync("0123456789012");

        using var supply = await client.PostAsJsonAsync(
            "/api/supplies",
            new { ean13 = "0123456789012", quantity = 3 });
        Assert.Equal(HttpStatusCode.Created, supply.StatusCode);

        using var response = await client.GetAsync("/api/history?ean13=0123456789012");
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var entry = Assert.Single(body.RootElement.EnumerateArray());
        Assert.Equal("SUPPLY", entry.GetProperty("type").GetString());
        Assert.Equal(3, entry.GetProperty("quantity").GetInt32());
        Assert.Equal(3, entry.GetProperty("stockEffect").GetInt32());
        Assert.Equal(3, entry.GetProperty("resultingPhysicalStock").GetInt32());
        Assert.Equal(3, entry.GetProperty("lines")[0].GetProperty("resultingPhysicalStock").GetInt32());
    }

    private sealed class HistoryHostFactory : WebApplicationFactory<Program>
    {
        private readonly string databasePath = Path.Combine(Path.GetTempPath(), $"token-warehouse-history-{Guid.NewGuid():N}.db");

        public async Task SeedAsync()
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            context.Articles.AddRange(
                Article("0123456789012", true),
                Article("7351353713578", true),
                Article("5901234123457", false));
            context.StockOperations.AddRange(
                Operation("bulk-0002", "supply", "0123456789012", "2030-01-15T09:00:00Z"),
                Operation("inventory-0003", "INVENTORY", "0123456789012", "2030-01-15T10:00:00Z", 5, 5, 0, 5),
                Operation("counter-0004", "COUNTER_MOVEMENT", "0123456789012", "2030-01-15T11:00:00Z", sourceOperationId: "bulk-0002", sourceOperationType: "SUPPLY", justification: "Correction de contrôle"));
            context.StockOperationLines.AddRange(
                Line("bulk-0002", 1, "0123456789012", "supply", 2, sourceEffect: 2),
                Line("bulk-0002", 2, "7351353713578", "supply", 3, sourceEffect: 3),
                Line("inventory-0003", 1, "0123456789012", "INVENTORY", 0, previousPhysicalStock: 5, countedQuantity: 5, resultingPhysicalStock: 5),
                Line("counter-0004", 1, "0123456789012", "COUNTER_MOVEMENT", 0, sourceEffect: 2, inverseEffect: -2));
            context.ArticleLifecycleHistory.Add(new ArticleLifecycleHistoryEntity
            {
                Ean13 = "5901234123457",
                PreviousStatus = "active",
                NextStatus = "archived",
                OccurredAt = "2030-01-15T10:30:00Z",
                Kind = "lifecycle"
            });
            await context.SaveChangesAsync();
        }

        public async Task SeedArticleAsync(string ean13)
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            context.Articles.Add(Article(ean13, true));
            await context.SaveChangesAsync();
        }

        public async Task<int> CountAsync()
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            return await context.StockOperations.CountAsync()
                + await context.StockOperationLines.CountAsync()
                + await context.ArticleLifecycleHistory.CountAsync();
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:Warehouse", $"Data Source={databasePath}");
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

        private static ArticleEntity Article(string ean13, bool isActive)
            => new()
            {
                Ean13 = ean13,
                Type = "food",
                Name = ean13,
                NameSearchKey = ean13,
                PriceHtCents = 100,
                IsActive = isActive,
                Dlc = "2099-01-15",
                ConsumptionModes = "takeaway"
            };

        private static StockOperationEntity Operation(
            string id,
            string type,
            string ean13,
            string timestampUtc,
            int previousPhysicalStock = 0,
            int countedQuantity = 0,
            int inventoryDifference = 0,
            int resultingPhysicalStock = 0,
            string? sourceOperationId = null,
            string? sourceOperationType = null,
            string? justification = null)
            => new()
            {
                Id = id,
                Type = type,
                Ean13 = ean13,
                Quantity = type == "supply" ? 5 : 0,
                OccurredAt = timestampUtc,
                PreviousPhysicalStock = previousPhysicalStock,
                CountedQuantity = countedQuantity,
                InventoryDifference = inventoryDifference,
                ResultingPhysicalStock = resultingPhysicalStock,
                TimestampUtc = timestampUtc,
                SourceOperationId = sourceOperationId,
                SourceOperationType = sourceOperationType,
                Justification = justification
            };

        private static StockOperationLineEntity Line(
            string operationId,
            int lineNumber,
            string ean13,
            string operationType,
            int quantity,
            int previousPhysicalStock = 0,
            int countedQuantity = 0,
            int resultingPhysicalStock = 0,
            int? sourceEffect = null,
            int? inverseEffect = null)
            => new()
            {
                OperationId = operationId,
                LineNumber = lineNumber,
                Ean13 = ean13,
                OperationType = operationType,
                Quantity = quantity,
                PreviousPhysicalStock = previousPhysicalStock,
                CountedQuantity = countedQuantity,
                InventoryDifference = countedQuantity - previousPhysicalStock,
                ResultingPhysicalStock = resultingPhysicalStock,
                SourceEffect = sourceEffect ?? quantity,
                InverseEffect = inverseEffect ?? 0
            };
    }
}
