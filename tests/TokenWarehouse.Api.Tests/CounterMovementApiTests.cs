using System.Net;
using System.Net.Http.Json;
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

public sealed class CounterMovementApiTests
{
    private static readonly DateTimeOffset Now =
        new(2030, 1, 15, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Corrects_a_supply_from_the_current_position_and_keeps_the_source_immutable()
    {
        using var factory = new CounterMovementHostFactory(Now);
        using var client = factory.CreateClient();
        await factory.SeedOperationAsync("supply-1", "0123456789012", "supply", 8, 10);

        using var sources = JsonDocument.Parse(await (await client.GetAsync(
            "/api/stock/counter-movements/sources")).Content.ReadAsStringAsync());
        Assert.Equal(1, sources.RootElement.GetArrayLength());
        Assert.Equal(8, sources.RootElement[0].GetProperty("lines")[0].GetProperty("stockEffect").GetInt32());

        using var response = await client.PostAsJsonAsync(
            "/api/stock/counter-movements",
            new { sourceOperationId = "supply-1", justification = " Correction après comptage " });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var counter = body.RootElement.GetProperty("counterMovement");
        Assert.Equal("COUNTER_MOVEMENT", counter.GetProperty("type").GetString());
        Assert.Equal("supply-1", counter.GetProperty("sourceOperationId").GetString());
        Assert.Equal("Correction après comptage", counter.GetProperty("justification").GetString());
        Assert.Equal(8, counter.GetProperty("lines")[0].GetProperty("sourceEffect").GetInt32());
        Assert.Equal(-8, counter.GetProperty("lines")[0].GetProperty("inverseEffect").GetInt32());
        Assert.Equal(2, body.RootElement.GetProperty("positions")[0].GetProperty("physicalStock").GetInt32());

        var state = await factory.ReadAsync(async context => new
        {
            Operations = await context.StockOperations.AsNoTracking().CountAsync(),
            Source = await context.StockOperations.AsNoTracking().SingleAsync(operation => operation.Id == "supply-1"),
            Position = await context.StockPositions.AsNoTracking().SingleAsync(position => position.Ean13 == "0123456789012")
        });
        Assert.Equal(2, state.Operations);
        Assert.Equal("supply", state.Source.Type);
        Assert.Null(state.Source.SourceOperationId);
        Assert.Equal(8, state.Source.Quantity);
        Assert.Equal(2, state.Position.PhysicalQuantity);

        var correctionId = counter.GetProperty("id").GetString();
        using var chained = await client.PostAsJsonAsync(
            "/api/stock/counter-movements",
            new { sourceOperationId = correctionId, justification = "Chaîne interdite" });
        Assert.Equal(HttpStatusCode.Conflict, chained.StatusCode);
        using var chainedBody = JsonDocument.Parse(await chained.Content.ReadAsStringAsync());
        Assert.Equal("SOURCE_IS_COUNTER_MOVEMENT", chainedBody.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Inverts_an_inventory_difference_and_a_sale_effect_on_the_current_position()
    {
        using var inventoryFactory = new CounterMovementHostFactory(Now);
        using var inventoryClient = inventoryFactory.CreateClient();
        await inventoryFactory.SeedOperationAsync(
            "inventory-1", "0123456789012", "INVENTORY", 3, 13, previousPhysicalStock: 8, countedQuantity: 11);

        using var inventoryResponse = await inventoryClient.PostAsJsonAsync(
            "/api/stock/counter-movements",
            new { sourceOperationId = "inventory-1", justification = "Correction inventaire" });
        Assert.Equal(HttpStatusCode.Created, inventoryResponse.StatusCode);
        using var inventoryBody = JsonDocument.Parse(await inventoryResponse.Content.ReadAsStringAsync());
        Assert.Equal(-3, inventoryBody.RootElement.GetProperty("counterMovement").GetProperty("lines")[0]
            .GetProperty("inverseEffect").GetInt32());
        Assert.Equal(10, inventoryBody.RootElement.GetProperty("positions")[0].GetProperty("physicalStock").GetInt32());

        var inventorySource = await inventoryFactory.ReadAsync(context => context.StockOperations
            .AsNoTracking()
            .SingleAsync(operation => operation.Id == "inventory-1"));
        Assert.Equal(8, inventorySource.PreviousPhysicalStock);
        Assert.Equal(11, inventorySource.CountedQuantity);
        Assert.Equal(3, inventorySource.InventoryDifference);

        using var saleFactory = new CounterMovementHostFactory(Now);
        using var saleClient = saleFactory.CreateClient();
        await saleFactory.SeedOperationAsync("sale-1", "0123456789012", "SALE", -3, 7);

        using var saleResponse = await saleClient.PostAsJsonAsync(
            "/api/stock/counter-movements",
            new { sourceOperationId = "sale-1", justification = "Restauration du stock" });
        Assert.Equal(HttpStatusCode.Created, saleResponse.StatusCode);
        using var saleBody = JsonDocument.Parse(await saleResponse.Content.ReadAsStringAsync());
        var saleCounter = saleBody.RootElement.GetProperty("counterMovement");
        Assert.Equal("SALE", saleCounter.GetProperty("sourceOperationType").GetString());
        Assert.Equal(3, saleCounter.GetProperty("lines")[0].GetProperty("inverseEffect").GetInt32());
        Assert.Equal(10, saleBody.RootElement.GetProperty("positions")[0].GetProperty("physicalStock").GetInt32());
    }

    [Fact]
    public async Task Allows_an_archived_article_but_keeps_it_not_sellable()
    {
        using var factory = new CounterMovementHostFactory(Now);
        using var client = factory.CreateClient();
        await factory.SeedOperationAsync("archived-1", "0123456789012", "supply", 2, 4, isActive: false);

        using var response = await client.PostAsJsonAsync(
            "/api/stock/counter-movements",
            new { sourceOperationId = "archived-1", justification = "Correction résiduelle" });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var position = body.RootElement.GetProperty("positions")[0];
        Assert.Equal(2, position.GetProperty("physicalStock").GetInt32());
        Assert.Equal(0, position.GetProperty("sellableStock").GetInt32());
        Assert.Equal("NOT_SELLABLE", position.GetProperty("availability").GetString());
        Assert.Equal("ARCHIVED", position.GetProperty("reason").GetString());

        var article = await factory.ReadAsync(context => context.Articles.AsNoTracking().SingleAsync());
        Assert.False(article.IsActive);
    }

    [Fact]
    public async Task Rejects_invalid_unknown_negative_and_bulk_partial_corrections_without_writes()
    {
        using var factory = new CounterMovementHostFactory(Now);
        using var client = factory.CreateClient();
        await factory.SeedOperationAsync("negative-1", "0123456789012", "supply", 8, 5);

        using var invalid = await client.PostAsJsonAsync(
            "/api/stock/counter-movements",
            new { sourceOperationId = "negative-1", justification = "   " });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal(1, await factory.ReadAsync(context => context.StockOperations.CountAsync()));

        using var unknown = await client.PostAsJsonAsync(
            "/api/stock/counter-movements",
            new { sourceOperationId = "unknown", justification = "Introuvable" });
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);

        using var negative = await client.PostAsJsonAsync(
            "/api/stock/counter-movements",
            new { sourceOperationId = "negative-1", justification = "Stock insuffisant" });
        Assert.Equal(HttpStatusCode.Conflict, negative.StatusCode);
        using var negativeBody = JsonDocument.Parse(await negative.Content.ReadAsStringAsync());
        Assert.Equal("RESULTING_STOCK_NEGATIVE", negativeBody.RootElement.GetProperty("code").GetString());
        Assert.Equal(5, await factory.ReadAsync(context => context.StockPositions
            .Where(position => position.Ean13 == "0123456789012")
            .Select(position => position.PhysicalQuantity)
            .SingleAsync()));

        await factory.SeedBulkSupplyAsync(
            "bulk-1",
            [("5901234123457", 5), ("7351353713578", 2)],
            [4, 6]);
        using var bulk = await client.PostAsJsonAsync(
            "/api/stock/counter-movements",
            new { sourceOperationId = "bulk-1", justification = "Lot impossible" });
        Assert.Equal(HttpStatusCode.Conflict, bulk.StatusCode);
        using var bulkBody = JsonDocument.Parse(await bulk.Content.ReadAsStringAsync());
        Assert.Equal("RESULTING_STOCK_NEGATIVE", bulkBody.RootElement.GetProperty("code").GetString());
        Assert.Equal(2, await factory.ReadAsync(context => context.StockOperations.CountAsync()));
        Assert.Equal(
            new[] { 5, 4, 6 },
            await factory.ReadAsync(context => context.StockPositions
                .OrderBy(position => position.Ean13)
                .Select(position => position.PhysicalQuantity)
                .ToArrayAsync()));
    }

    [Fact]
    public async Task Rolls_back_positions_and_history_when_counter_line_persistence_fails()
    {
        using var factory = new CounterMovementHostFactory(Now);
        using var client = factory.CreateClient();
        await factory.SeedOperationAsync("failure-1", "0123456789012", "supply", 8, 10);
        await factory.FailCounterLineInsertsAsync();

        using var response = await client.PostAsJsonAsync(
            "/api/stock/counter-movements",
            new { sourceOperationId = "failure-1", justification = "Panne contrôlée" });

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("PERSISTENCE_FAILURE", body.RootElement.GetProperty("code").GetString());
        var state = await factory.ReadAsync(async context => new
        {
            Operations = await context.StockOperations.CountAsync(),
            Lines = await context.StockOperationLines.CountAsync(),
            Position = await context.StockPositions.SingleAsync()
        });
        Assert.Equal(1, state.Operations);
        Assert.Equal(1, state.Lines);
        Assert.Equal(10, state.Position.PhysicalQuantity);
    }

    [Fact]
    public async Task Allows_only_one_concurrent_correction_of_the_same_source()
    {
        using var commitBarrier = new Barrier(2);
        using var factory = new CounterMovementHostFactory(Now, counterCommitBarrier: commitBarrier);
        using var firstClient = factory.CreateClient();
        using var secondClient = factory.CreateClient();
        await factory.SeedOperationAsync("concurrent-source", "0123456789012", "supply", 8, 10);

        var responses = await Task.WhenAll(
            firstClient.PostAsJsonAsync(
                "/api/stock/counter-movements",
                new { sourceOperationId = "concurrent-source", justification = "Correction 1" }),
            secondClient.PostAsJsonAsync(
                "/api/stock/counter-movements",
                new { sourceOperationId = "concurrent-source", justification = "Correction 2" }));

        try
        {
            Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Created);
            Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Conflict);

            using var conflictBody = JsonDocument.Parse(
                await responses.Single(response => response.StatusCode == HttpStatusCode.Conflict)
                    .Content.ReadAsStringAsync());
            Assert.Equal("POSITION_CONFLICT", conflictBody.RootElement.GetProperty("code").GetString());

            var state = await factory.ReadFreshAsync(async context => new
            {
                OperationCount = await context.StockOperations.AsNoTracking().CountAsync(),
                OperationLineCount = await context.StockOperationLines.AsNoTracking().CountAsync(),
                CounterCount = await context.StockOperations.AsNoTracking()
                    .CountAsync(operation => operation.Type == "COUNTER_MOVEMENT"),
                SourceLinkCount = await context.StockOperations.AsNoTracking()
                    .CountAsync(operation => operation.SourceOperationId == "concurrent-source"),
                Source = await context.StockOperations.AsNoTracking()
                    .Where(operation => operation.Id == "concurrent-source")
                    .Select(operation => new
                    {
                        operation.Type,
                        operation.Ean13,
                        operation.Quantity,
                        operation.OccurredAt,
                        operation.TimestampUtc,
                        operation.SourceOperationId,
                        operation.SourceOperationType,
                        operation.Justification
                    })
                    .SingleAsync(),
                SourceLine = await context.StockOperationLines.AsNoTracking()
                    .Where(line => line.OperationId == "concurrent-source")
                    .Select(line => new { line.OperationType, line.Quantity, line.SourceEffect, line.InverseEffect })
                    .SingleAsync(),
                CounterLine = await context.StockOperationLines.AsNoTracking()
                    .Where(line => line.OperationType == "COUNTER_MOVEMENT")
                    .Select(line => new { line.SourceEffect, line.InverseEffect })
                    .SingleAsync(),
                Position = await context.StockPositions.AsNoTracking()
                    .Where(position => position.Ean13 == "0123456789012")
                    .Select(position => new { position.PhysicalQuantity, position.Version })
                    .SingleAsync()
            });

            Assert.Equal(2, state.OperationCount);
            Assert.Equal(2, state.OperationLineCount);
            Assert.Equal(1, state.CounterCount);
            Assert.Equal(1, state.SourceLinkCount);
            Assert.Equal("supply", state.Source.Type);
            Assert.Equal("0123456789012", state.Source.Ean13);
            Assert.Equal(8, state.Source.Quantity);
            Assert.Equal(Now.ToString("O"), state.Source.OccurredAt);
            Assert.Equal(Now.ToString("O"), state.Source.TimestampUtc);
            Assert.Null(state.Source.SourceOperationId);
            Assert.Null(state.Source.SourceOperationType);
            Assert.Null(state.Source.Justification);
            Assert.Equal("supply", state.SourceLine.OperationType);
            Assert.Equal(8, state.SourceLine.Quantity);
            Assert.Equal(8, state.SourceLine.SourceEffect);
            Assert.Equal(0, state.SourceLine.InverseEffect);
            Assert.Equal(8, state.CounterLine.SourceEffect);
            Assert.Equal(-8, state.CounterLine.InverseEffect);
            Assert.Equal(2, state.Position.PhysicalQuantity);
            Assert.Equal(1, state.Position.Version);
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
    public async Task Rejects_a_stale_counter_or_supply_commit_without_partial_state()
    {
        using var commitBarrier = new Barrier(2);
        using var factory = new CounterMovementHostFactory(
            Now,
            counterCommitBarrier: commitBarrier,
            supplyCommitBarrier: commitBarrier);
        using var counterClient = factory.CreateClient();
        using var supplyClient = factory.CreateClient();
        await factory.SeedOperationAsync("overlap-source", "0123456789012", "supply", 8, 10);

        var responses = await Task.WhenAll(
            counterClient.PostAsJsonAsync(
                "/api/stock/counter-movements",
                new { sourceOperationId = "overlap-source", justification = "Correction concurrente" }),
            supplyClient.PostAsJsonAsync(
                "/api/supplies",
                new { ean13 = "0123456789012", quantity = 3 }));

        try
        {
            Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Created);
            Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Conflict);

            using var counterConflictBody = responses[0].StatusCode == HttpStatusCode.Conflict
                ? JsonDocument.Parse(await responses[0].Content.ReadAsStringAsync())
                : null;
            using var supplyConflictBody = responses[1].StatusCode == HttpStatusCode.Conflict
                ? JsonDocument.Parse(await responses[1].Content.ReadAsStringAsync())
                : null;
            if (counterConflictBody is not null)
            {
                Assert.Equal("POSITION_CONFLICT", counterConflictBody.RootElement.GetProperty("code").GetString());
            }

            if (supplyConflictBody is not null)
            {
                Assert.Equal("supply.commit.conflict", supplyConflictBody.RootElement.GetProperty("code").GetString());
            }

            var state = await factory.ReadFreshAsync(async context => new
            {
                OperationCount = await context.StockOperations.AsNoTracking().CountAsync(),
                OperationLineCount = await context.StockOperationLines.AsNoTracking().CountAsync(),
                CounterCount = await context.StockOperations.AsNoTracking()
                    .CountAsync(operation => operation.Type == "COUNTER_MOVEMENT"),
                SupplyCount = await context.StockOperations.AsNoTracking()
                    .CountAsync(operation => operation.Type == "supply" && operation.Id != "overlap-source"),
                SourceLinkCount = await context.StockOperations.AsNoTracking()
                    .CountAsync(operation => operation.SourceOperationId == "overlap-source"),
                Source = await context.StockOperations.AsNoTracking()
                    .Where(operation => operation.Id == "overlap-source")
                    .Select(operation => new
                    {
                        operation.Type,
                        operation.Ean13,
                        operation.Quantity,
                        operation.SourceOperationId,
                        operation.SourceOperationType,
                        operation.Justification
                    })
                    .SingleAsync(),
                Counter = await context.StockOperations.AsNoTracking()
                    .Where(operation => operation.Type == "COUNTER_MOVEMENT")
                    .Select(operation => new
                    {
                        operation.Id,
                        operation.Type,
                        operation.Ean13,
                        operation.SourceOperationId,
                        operation.SourceOperationType,
                        operation.Justification
                    })
                    .SingleOrDefaultAsync(),
                Position = await context.StockPositions.AsNoTracking()
                    .Where(position => position.Ean13 == "0123456789012")
                    .Select(position => new { position.PhysicalQuantity, position.Version })
                    .SingleAsync(),
                CounterLine = await context.StockOperationLines.AsNoTracking()
                    .Where(line => line.OperationType == "COUNTER_MOVEMENT")
                    .Select(line => new { line.OperationId, line.Ean13, line.SourceEffect, line.InverseEffect })
                    .SingleOrDefaultAsync(),
                SupplyLine = await context.StockOperationLines.AsNoTracking()
                    .Where(line => line.OperationType == "supply" && line.OperationId != "overlap-source")
                    .Select(line => new { line.OperationId, line.Ean13, line.Quantity, line.SourceEffect, line.InverseEffect })
                    .SingleOrDefaultAsync(),
                Supply = await context.StockOperations.AsNoTracking()
                    .Where(operation => operation.Type == "supply" && operation.Id != "overlap-source")
                    .Select(operation => new { operation.Id, operation.Type, operation.Ean13, operation.Quantity })
                    .SingleOrDefaultAsync()
            });

            Assert.Equal(2, state.OperationCount);
            Assert.Equal(2, state.OperationLineCount);
            Assert.Equal(1, state.CounterCount + state.SupplyCount);
            Assert.Equal("supply", state.Source.Type);
            Assert.Equal("0123456789012", state.Source.Ean13);
            Assert.Equal(8, state.Source.Quantity);
            Assert.Null(state.Source.SourceOperationId);
            Assert.Null(state.Source.SourceOperationType);
            Assert.Null(state.Source.Justification);
            Assert.Equal(state.CounterCount, state.SourceLinkCount);

            if (state.CounterCount == 1)
            {
                Assert.Equal(0, state.SupplyCount);
                Assert.Equal(1, state.SourceLinkCount);
                Assert.Equal(2, state.Position.PhysicalQuantity);
                Assert.Equal("COUNTER_MOVEMENT", state.Counter?.Type);
                Assert.Equal("0123456789012", state.Counter?.Ean13);
                Assert.Equal("overlap-source", state.Counter?.SourceOperationId);
                Assert.Equal("SUPPLY", state.Counter?.SourceOperationType);
                Assert.Equal("Correction concurrente", state.Counter?.Justification);
                Assert.Equal(state.Counter?.Id, state.CounterLine?.OperationId);
                Assert.Equal("0123456789012", state.CounterLine?.Ean13);
                Assert.Equal(8, state.CounterLine?.SourceEffect);
                Assert.Equal(-8, state.CounterLine?.InverseEffect);
                Assert.Null(state.SupplyLine);
            }
            else
            {
                Assert.Equal(0, state.CounterCount);
                Assert.Equal(0, state.SourceLinkCount);
                Assert.Equal(13, state.Position.PhysicalQuantity);
                Assert.Equal("supply", state.Supply?.Type);
                Assert.Equal("0123456789012", state.Supply?.Ean13);
                Assert.Equal(3, state.Supply?.Quantity);
                Assert.Null(state.CounterLine);
                Assert.Equal(state.Supply?.Id, state.SupplyLine?.OperationId);
                Assert.Equal("0123456789012", state.SupplyLine?.Ean13);
                Assert.Equal(3, state.SupplyLine?.Quantity);
                Assert.Equal(3, state.SupplyLine?.SourceEffect);
                Assert.Equal(0, state.SupplyLine?.InverseEffect);
            }

            Assert.Equal(1, state.Position.Version);
        }
        finally
        {
            foreach (var response in responses)
            {
                response.Dispose();
            }
        }
    }

    private sealed class CounterMovementHostFactory : WebApplicationFactory<Program>
    {
        private readonly string connectionString =
            $"Data Source=file:counter-movement-{Guid.NewGuid():N};Mode=Memory;Cache=Shared";
        private readonly SqliteConnection keeperConnection;
        private readonly DateTimeOffset now;
        private readonly Barrier? counterCommitBarrier;
        private readonly Barrier? supplyCommitBarrier;

        public CounterMovementHostFactory(
            DateTimeOffset now,
            Barrier? counterCommitBarrier = null,
            Barrier? supplyCommitBarrier = null)
        {
            this.now = now;
            this.counterCommitBarrier = counterCommitBarrier;
            this.supplyCommitBarrier = supplyCommitBarrier;
            keeperConnection = new SqliteConnection(connectionString);
            keeperConnection.Open();
        }

        public async Task SeedOperationAsync(
            string id,
            string ean13,
            string type,
            int sourceEffect,
            int currentPhysicalStock,
            bool isActive = true,
            int previousPhysicalStock = 0,
            int countedQuantity = 0)
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            context.Articles.Add(CreateArticle(ean13, isActive));
            context.StockPositions.Add(new StockPositionEntity
            {
                Ean13 = ean13,
                PhysicalQuantity = currentPhysicalStock,
                Version = 0
            });
            context.StockOperations.Add(CreateOperation(
                id,
                ean13,
                type,
                sourceEffect,
                previousPhysicalStock,
                countedQuantity));
            context.StockOperationLines.Add(CreateLine(
                id,
                1,
                ean13,
                type,
                sourceEffect,
                previousPhysicalStock,
                countedQuantity));
            await context.SaveChangesAsync();
        }

        public async Task SeedBulkSupplyAsync(
            string id,
            (string Ean13, int Effect)[] lines,
            int[] currentPositions)
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            for (var index = 0; index < lines.Length; index++)
            {
                context.Articles.Add(CreateArticle(lines[index].Ean13, true));
                context.StockPositions.Add(new StockPositionEntity
                {
                    Ean13 = lines[index].Ean13,
                    PhysicalQuantity = currentPositions[index],
                    Version = 0
                });
            }

            context.StockOperations.Add(CreateOperation(
                id,
                lines[0].Ean13,
                "supply",
                lines.Sum(line => line.Effect),
                0,
                0));
            context.StockOperationLines.AddRange(lines.Select((line, index) => CreateLine(
                id,
                index + 1,
                line.Ean13,
                "supply",
                line.Effect,
                0,
                0)));
            await context.SaveChangesAsync();
        }

        public async Task FailCounterLineInsertsAsync()
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            await context.Database.ExecuteSqlRawAsync(
                """
                CREATE TRIGGER FailCounterLineInsert
                BEFORE INSERT ON StockOperationLines
                WHEN NEW.OperationType = 'COUNTER_MOVEMENT'
                BEGIN
                    SELECT RAISE(ABORT, 'controlled counter failure');
                END;
                """);
        }

        public async Task<T> ReadAsync<T>(Func<WarehouseDbContext, Task<T>> read)
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            return await read(context);
        }

        public async Task<T> ReadFreshAsync<T>(Func<WarehouseDbContext, Task<T>> read)
        {
            await using var connection = new SqliteConnection(connectionString);
            await connection.OpenAsync();
            var options = new DbContextOptionsBuilder<WarehouseDbContext>()
                .UseSqlite(connection)
                .Options;
            await using var context = new WarehouseDbContext(options);
            return await read(context);
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
                if (counterCommitBarrier is not null)
                {
                    services.RemoveAll<IStockMutationCommitter>();
                    services.AddScoped<IStockMutationCommitter>(serviceProvider => new GatedCounterMovementCommitter(
                        new SqliteStockMutationCommitter(
                            serviceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>()),
                        counterCommitBarrier));
                }

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

        private static ArticleEntity CreateArticle(string ean13, bool isActive)
            => new()
            {
                Ean13 = ean13,
                Type = "food",
                Name = "Article de test",
                NameSearchKey = "ARTICLE DE TEST",
                PriceHtCents = 100,
                IsActive = isActive,
                Version = 0,
                Dlc = "2099-01-15",
                ConsumptionModes = "takeaway"
            };

        private StockOperationEntity CreateOperation(
            string id,
            string ean13,
            string type,
            int sourceEffect,
            int previousPhysicalStock,
            int countedQuantity)
            => new()
            {
                Id = id,
                Type = type,
                Ean13 = ean13,
                Quantity = type is "supply" or "SALE" ? Math.Abs(sourceEffect) : 0,
                OccurredAt = now.ToString("O"),
                PreviousPhysicalStock = previousPhysicalStock,
                CountedQuantity = countedQuantity,
                InventoryDifference = type == "INVENTORY" ? sourceEffect : 0,
                ResultingPhysicalStock = type == "INVENTORY" ? countedQuantity : 0,
                TimestampUtc = now.ToString("O")
            };

        private static StockOperationLineEntity CreateLine(
            string operationId,
            int lineNumber,
            string ean13,
            string type,
            int sourceEffect,
            int previousPhysicalStock,
            int countedQuantity)
            => new()
            {
                OperationId = operationId,
                LineNumber = lineNumber,
                Ean13 = ean13,
                OperationType = type,
                Quantity = type is "supply" or "SALE" ? Math.Abs(sourceEffect) : 0,
                PreviousPhysicalStock = previousPhysicalStock,
                CountedQuantity = countedQuantity,
                InventoryDifference = type == "INVENTORY" ? sourceEffect : 0,
                ResultingPhysicalStock = type == "INVENTORY" ? countedQuantity : 0,
                SourceEffect = sourceEffect,
                InverseEffect = 0
            };
    }

    private sealed class GatedCounterMovementCommitter(
        IStockMutationCommitter inner,
        Barrier barrier) : IStockMutationCommitter
    {
        public ValueTask<StockMutationCommitResult> CommitAsync(
            InventoryCommitPlan plan,
            CancellationToken cancellationToken = default)
            => inner.CommitAsync(plan, cancellationToken);

        public async ValueTask<StockMutationCommitResult> CommitAsync(
            CounterMovementCommitPlan plan,
            CancellationToken cancellationToken = default)
        {
            barrier.SignalAndWait(TimeSpan.FromSeconds(10), cancellationToken);
            return await inner.CommitAsync(plan, cancellationToken);
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

        public ValueTask<BulkSupplyCommitResult> CommitAsync(
            BulkSupplyCommitRequest request,
            CancellationToken cancellationToken = default)
            => inner.CommitAsync(request, cancellationToken);
    }

    private sealed class FixedClock(DateTimeOffset now) : IClock
    {
        public DateTimeOffset UtcNow => now;
    }
}
