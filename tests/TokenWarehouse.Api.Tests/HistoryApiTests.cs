using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Data.Common;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;
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
        var before = await factory.SnapshotAsync();

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
        Assert.Equal("fact_catalog_archive_01J00000000000000000000000", body.RootElement[1].GetProperty("id").GetString());
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

        using var archived = await client.GetAsync("/api/history?ean13=5901234123457");
        using var archivedBody = JsonDocument.Parse(await archived.Content.ReadAsStringAsync());
        var archivedEntry = Assert.Single(archivedBody.RootElement.EnumerateArray());
        Assert.Equal("CATALOG_ARCHIVE", archivedEntry.GetProperty("type").GetString());
        Assert.Equal("fact_catalog_archive_01J00000000000000000000000", archivedEntry.GetProperty("id").GetString());

        using var unknown = await client.GetAsync("/api/history?ean13=4006381333931");
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        using var unknownBody = JsonDocument.Parse(await unknown.Content.ReadAsStringAsync());
        Assert.Equal("ARTICLE_NOT_FOUND", unknownBody.RootElement.GetProperty("code").GetString());

        using var invalid = await client.GetAsync("/api/history?ean13=not-an-ean");
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        using var invalidBody = JsonDocument.Parse(await invalid.Content.ReadAsStringAsync());
        Assert.Equal("INVALID_EAN13", invalidBody.RootElement.GetProperty("code").GetString());

        using var repeatedGlobal = await client.GetAsync("/api/history");
        using var repeatedFiltered = await client.GetAsync("/api/history?ean13=0123456789012");
        Assert.Equal(HttpStatusCode.OK, repeatedGlobal.StatusCode);
        Assert.Equal(HttpStatusCode.OK, repeatedFiltered.StatusCode);
        Assert.Equal(before, await factory.ReadFreshSnapshotAsync());
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

    [Fact]
    public async Task Orders_equal_timestamps_by_operation_id()
    {
        using var factory = new HistoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedEqualTimestampOperationsAsync();

        using var response = await client.GetAsync("/api/history");
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

        Assert.Equal(
            new[] { "operation-0002", "operation-0001" },
            body.RootElement.EnumerateArray().Select(entry => entry.GetProperty("id").GetString()).ToArray());
    }

    [Fact]
    public async Task Reads_sale_and_catalogue_attribute_facts_for_active_and_archived_articles()
    {
        using var factory = new HistoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedCoverageAsync();

        using var response = await client.GetAsync("/api/history");
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var entries = body.RootElement.EnumerateArray().ToArray();

        var sale = Assert.Single(entries, entry => entry.GetProperty("type").GetString() == "SALE_STOCK");
        Assert.Equal(3, sale.GetProperty("quantity").GetInt32());
        Assert.Equal(-3, sale.GetProperty("stockEffect").GetInt32());
        Assert.Equal(7, sale.GetProperty("resultingPhysicalStock").GetInt32());
        Assert.Contains(entries, entry => entry.GetProperty("type").GetString() == "CATALOG_DLC_CHANGE");
        Assert.Contains(entries, entry => entry.GetProperty("type").GetString() == "CATALOG_PACKAGING_CHANGE");

        using var archived = await client.GetAsync("/api/history?ean13=5901234123457");
        using var archivedBody = JsonDocument.Parse(await archived.Content.ReadAsStringAsync());
        Assert.Contains(
            archivedBody.RootElement.EnumerateArray(),
            entry => entry.GetProperty("type").GetString() == "CATALOG_ARCHIVE");
        Assert.All(
            archivedBody.RootElement.EnumerateArray(),
            entry => Assert.All(
                entry.GetProperty("articles").EnumerateArray(),
                article => Assert.Equal("5901234123457", article.GetProperty("ean13").GetString())));
    }

    [Fact]
    public async Task Maps_history_reader_failures_to_problem_details()
    {
        using var factory = new HistoryHostFactory(failHistory: true);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/api/history");

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("HISTORY_READ_FAILURE", body.RootElement.GetProperty("code").GetString());
        Assert.DoesNotContain("SQL", body.RootElement.GetRawText(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Reads_history_from_one_sqlite_snapshot_when_catalogue_changes_between_queries()
    {
        var databasePath = Path.Combine(Path.GetTempPath(), $"token-warehouse-history-snapshot-{Guid.NewGuid():N}.db");
        try
        {
            await using var setupConnection = new SqliteConnection($"Data Source={databasePath}");
            await setupConnection.OpenAsync();
            var setupOptions = new DbContextOptionsBuilder<WarehouseDbContext>()
                .UseSqlite(setupConnection)
                .Options;
            await using (var setupContext = new WarehouseDbContext(setupOptions))
            {
                await setupContext.Database.MigrateAsync();
                setupContext.Articles.Add(new ArticleEntity
                {
                    Ean13 = "0123456789012",
                    Type = "food",
                    Name = "0123456789012",
                    NameSearchKey = "0123456789012",
                    PriceHtCents = 100,
                    IsActive = true,
                    Dlc = "2099-01-15",
                    ConsumptionModes = "takeaway"
                });
                await setupContext.SaveChangesAsync();
            }
            await using (var journalModeCommand = setupConnection.CreateCommand())
            {
                journalModeCommand.CommandText = "PRAGMA journal_mode=WAL";
                await journalModeCommand.ExecuteScalarAsync();
            }
            await setupConnection.CloseAsync();

            var interceptor = new InjectLifecycleFactBeforeOperationsQuery(databasePath);
            var reader = new SqliteHistoryReader(new HistoryDbContextFactory(
                $"Data Source={databasePath}",
                interceptor));

            Ean13.TryCreate("0123456789012", out var ean13);
            var result = await reader.ReadAsync(new HistoryQuery(ean13));

            Assert.True(interceptor.WriterCommitted || interceptor.WriterBlocked);
            Assert.DoesNotContain(result.Entries, entry => entry.Id == "fact_concurrent_catalogue_01J00000000000000000000000");
            if (interceptor.WriterBlocked)
            {
                interceptor.CommitPendingFact();
            }
            var freshResult = await new SqliteHistoryReader(new HistoryDbContextFactory($"Data Source={databasePath}"))
                .ReadAsync(new HistoryQuery(ean13));
            Assert.Contains(freshResult.Entries, entry => entry.Id == "fact_concurrent_catalogue_01J00000000000000000000000");
        }
        finally
        {
            File.Delete(databasePath);
            File.Delete($"{databasePath}-wal");
            File.Delete($"{databasePath}-shm");
        }
    }

    private sealed class HistoryHostFactory(bool failHistory = false) : WebApplicationFactory<Program>
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
            context.StockPositions.AddRange(
                Position("0123456789012", 5),
                Position("7351353713578", 3),
                Position("5901234123457", 4));
            context.ArticleLifecycleHistory.Add(new ArticleLifecycleHistoryEntity
            {
                FactId = "fact_catalog_archive_01J00000000000000000000000",
                Ean13 = "5901234123457",
                PreviousStatus = "active",
                NextStatus = "archived",
                OccurredAt = "2030-01-15T10:30:00Z",
                Kind = "lifecycle"
            });
            await context.SaveChangesAsync();
        }

        public async Task SeedEqualTimestampOperationsAsync()
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            context.Articles.Add(Article("0123456789012", true));
            context.StockOperations.AddRange(
                Operation("operation-0001", "supply", "0123456789012", "2030-01-15T10:00:00Z"),
                Operation("operation-0002", "supply", "0123456789012", "2030-01-15T10:00:00Z"));
            await context.SaveChangesAsync();
        }

        public async Task SeedCoverageAsync()
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            context.Articles.AddRange(
                Article("0123456789012", true),
                new ArticleEntity
                {
                    Ean13 = "7351353713578",
                    Type = "nonFood",
                    Name = "Packaging",
                    NameSearchKey = "PACKAGING",
                    PriceHtCents = 100,
                    IsActive = true,
                    Packaging = "new"
                },
                Article("5901234123457", false));
            context.StockPositions.AddRange(
                Position("0123456789012", 7),
                Position("7351353713578", 4),
                Position("5901234123457", 4));
            context.StockOperations.Add(Operation(
                "sale-0005",
                "SALE",
                "0123456789012",
                "2030-01-15T10:00:00Z",
                previousPhysicalStock: 10,
                resultingPhysicalStock: 7,
                quantity: 3));
            context.StockOperationLines.Add(Line(
                "sale-0005",
                1,
                "0123456789012",
                "SALE",
                3,
                previousPhysicalStock: 10,
                resultingPhysicalStock: 7,
                sourceEffect: -3));
            context.ArticleLifecycleHistory.AddRange(
                new ArticleLifecycleHistoryEntity
                {
                    FactId = "fact_catalog_dlc_01J00000000000000000000000",
                    Ean13 = "0123456789012",
                    OccurredAt = "2030-01-15T11:00:00Z",
                    Kind = "attributes",
                    ChangesJson = JsonSerializer.Serialize(new[]
                    {
                        new { Field = "dlc", PreviousValue = "2030-01-15", NextValue = "2030-01-20" }
                    })
                },
                new ArticleLifecycleHistoryEntity
                {
                    FactId = "fact_catalog_packaging_01J00000000000000000000000",
                    Ean13 = "7351353713578",
                    OccurredAt = "2030-01-15T11:01:00Z",
                    Kind = "attributes",
                    ChangesJson = JsonSerializer.Serialize(new[]
                    {
                        new { Field = "packaging", PreviousValue = "new", NextValue = "unsellable" }
                    })
                },
                new ArticleLifecycleHistoryEntity
                {
                    FactId = "fact_catalog_archive_01J00000000000000000000000",
                    Ean13 = "5901234123457",
                    PreviousStatus = "active",
                    NextStatus = "archived",
                    OccurredAt = "2030-01-15T11:02:00Z",
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

        public async Task<string> SnapshotAsync()
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            return await SnapshotAsync(context);
        }

        public async Task<string> ReadFreshSnapshotAsync()
        {
            await using var connection = new SqliteConnection($"Data Source={databasePath}");
            await connection.OpenAsync();
            var options = new DbContextOptionsBuilder<WarehouseDbContext>()
                .UseSqlite(connection)
                .Options;
            await using var context = new WarehouseDbContext(options);
            return await SnapshotAsync(context);
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:Warehouse", $"Data Source={databasePath}");
            if (failHistory)
            {
                builder.ConfigureServices(services =>
                {
                    services.RemoveAll<IHistoryReader>();
                    services.AddScoped<IHistoryReader, ThrowingHistoryReader>();
                });
            }
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

        private static StockPositionEntity Position(string ean13, int quantity)
            => new()
            {
                Ean13 = ean13,
                PhysicalQuantity = quantity,
                Version = 0
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
            string? justification = null,
            int? quantity = null)
            => new()
            {
                Id = id,
                Type = type,
                Ean13 = ean13,
                Quantity = quantity ?? (type.Equals("supply", StringComparison.OrdinalIgnoreCase) ? 5 : 0),
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

        private static async Task<string> SnapshotAsync(WarehouseDbContext context)
        {
            var articles = await context.Articles.AsNoTracking().OrderBy(entity => entity.Ean13).ToListAsync();
            var positions = await context.StockPositions.AsNoTracking().OrderBy(entity => entity.Ean13).ToListAsync();
            var operations = await context.StockOperations.AsNoTracking().OrderBy(entity => entity.Id).ToListAsync();
            var lines = await context.StockOperationLines.AsNoTracking().OrderBy(entity => entity.OperationId).ThenBy(entity => entity.LineNumber).ToListAsync();
            var lifecycle = await context.ArticleLifecycleHistory.AsNoTracking().OrderBy(entity => entity.FactId).ToListAsync();
            return JsonSerializer.Serialize(new
            {
                articles,
                positions,
                operations,
                lines,
                lifecycle
            });
        }
    }

    private sealed class ThrowingHistoryReader : IHistoryReader
    {
        public ValueTask<HistoryReadResult> ReadAsync(
            HistoryQuery query,
            CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("controlled history failure");
    }

    private sealed class HistoryDbContextFactory(
        string connectionString,
        DbCommandInterceptor? interceptor = null) : IDbContextFactory<WarehouseDbContext>
    {
        public WarehouseDbContext CreateDbContext()
            => Create();

        public Task<WarehouseDbContext> CreateDbContextAsync(CancellationToken cancellationToken = default)
            => Task.FromResult(Create());

        private WarehouseDbContext Create()
        {
            var options = new DbContextOptionsBuilder<WarehouseDbContext>()
                .UseSqlite(connectionString);
            if (interceptor is not null)
            {
                options.AddInterceptors(interceptor);
            }

            return new WarehouseDbContext(options.Options);
        }
    }

    private sealed class InjectLifecycleFactBeforeOperationsQuery(string databasePath) : DbCommandInterceptor
    {
        private bool writerAttempted;

        public bool WriterCommitted { get; private set; }

        public bool WriterBlocked { get; private set; }

        public override InterceptionResult<DbDataReader> ReaderExecuting(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result)
        {
            InjectIfOperationsQuery(command);
            return result;
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            InjectIfOperationsQuery(command);
            return ValueTask.FromResult(result);
        }

        private void InjectIfOperationsQuery(DbCommand command)
        {
            if (writerAttempted || !command.CommandText.Contains("StockOperations", StringComparison.Ordinal))
            {
                return;
            }
            writerAttempted = true;

            using var connection = new SqliteConnection($"Data Source={databasePath};Default Timeout=1");
            connection.DefaultTimeout = 1;
            connection.Open();
            var options = new DbContextOptionsBuilder<WarehouseDbContext>()
                .UseSqlite(connection)
                .Options;
            using var context = new WarehouseDbContext(options);
            context.Database.SetCommandTimeout(1);
            context.ArticleLifecycleHistory.Add(new ArticleLifecycleHistoryEntity
            {
                FactId = "fact_concurrent_catalogue_01J00000000000000000000000",
                Ean13 = "0123456789012",
                PreviousStatus = "active",
                NextStatus = "archived",
                OccurredAt = "2030-01-15T12:00:00Z",
                Kind = "lifecycle"
            });
            try
            {
                context.SaveChanges();
                WriterCommitted = true;
            }
            catch (DbUpdateException exception) when (exception.InnerException is SqliteException
            {
                SqliteErrorCode: 5 or 6
            })
            {
                WriterBlocked = true;
            }
        }

        public void CommitPendingFact()
        {
            using var connection = new SqliteConnection($"Data Source={databasePath}");
            connection.Open();
            var options = new DbContextOptionsBuilder<WarehouseDbContext>()
                .UseSqlite(connection)
                .Options;
            using var context = new WarehouseDbContext(options);
            context.ArticleLifecycleHistory.Add(new ArticleLifecycleHistoryEntity
            {
                FactId = "fact_concurrent_catalogue_01J00000000000000000000000",
                Ean13 = "0123456789012",
                PreviousStatus = "active",
                NextStatus = "archived",
                OccurredAt = "2030-01-15T12:00:00Z",
                Kind = "lifecycle"
            });
            context.SaveChanges();
        }
    }
}
