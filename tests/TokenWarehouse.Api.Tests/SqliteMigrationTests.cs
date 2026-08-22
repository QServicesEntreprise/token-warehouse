using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TokenWarehouse.Infrastructure.Persistence;
using Xunit;

namespace TokenWarehouse.Api.Tests;

public sealed class SqliteMigrationTests
{
    [Fact]
    public async Task Sale_snapshot_constraints_are_materialized_by_the_applied_migration()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<WarehouseDbContext>()
            .UseSqlite(connection)
            .Options;

        await using var context = new WarehouseDbContext(options);
        await context.Database.MigrateAsync();

        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'TR_StockOperations_SaleFinancialSnapshot_%' ORDER BY name";
        await using var reader = await command.ExecuteReaderAsync();
        var triggerNames = new List<string>();
        while (await reader.ReadAsync())
        {
            triggerNames.Add(reader.GetString(0));
        }

        foreach (var trigger in new[]
        {
            "TR_StockOperations_SaleFinancialSnapshot_Constraints_Insert",
            "TR_StockOperations_SaleFinancialSnapshot_Constraints_Update",
            "TR_StockOperations_SaleFinancialSnapshot_Immutable",
            "TR_StockOperations_SaleFinancialSnapshot_Delete"
        })
        {
            Assert.Contains(trigger, triggerNames);
        }

        context.Articles.Add(new ArticleEntity
        {
            Ean13 = "0123456789012",
            Type = "food",
            Name = "Article vendu",
            NameSearchKey = "ARTICLE VENDU",
            PriceHtCents = 99,
            IsActive = true,
            Dlc = "2030-01-15",
            ConsumptionModes = "takeaway"
        });
        context.StockOperations.Add(new StockOperationEntity
        {
            Id = "invalid-sale-snapshot",
            Type = "SALE",
            Ean13 = "0123456789012",
            Quantity = 2,
            OccurredAt = "2030-01-15T10:00:00.0000000+00:00",
            TimestampUtc = "2030-01-15T10:00:00.0000000+00:00",
            SaleCommitDataType = "sale.financial.v1",
            SaleCommitDataPayload = "{}"
        });
        await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
    }

    [Fact]
    public async Task Migrations_survive_shared_memory_contexts_and_file_reopen()
    {
        var filePath = Path.Combine(Path.GetTempPath(), $"token-warehouse-{Guid.NewGuid():N}.db");

        try
        {
            await using (var fileConnection = new SqliteConnection($"Data Source={filePath}"))
            {
                await fileConnection.OpenAsync();
                var options = new DbContextOptionsBuilder<WarehouseDbContext>()
                    .UseSqlite(fileConnection)
                    .Options;

                await using var context = new WarehouseDbContext(options);
                await context.Database.MigrateAsync();
                var applied = (await context.Database.GetAppliedMigrationsAsync()).ToArray();
                await context.Database.MigrateAsync();

                await using var schemaCommand = context.Database.GetDbConnection().CreateCommand();
                schemaCommand.CommandText = "PRAGMA table_info('Articles')";
                await using var schemaReader = await schemaCommand.ExecuteReaderAsync();
                var columns = new List<string>();
                while (await schemaReader.ReadAsync())
                {
                    columns.Add(schemaReader.GetString(1));
                }

                Assert.NotEmpty(applied);
                Assert.Equal(applied, (await context.Database.GetAppliedMigrationsAsync()).ToArray());
                Assert.Contains("PriceHtCents", columns);
                Assert.DoesNotContain("PriceTtcCents", columns);
                Assert.DoesNotContain("VatCents", columns);
            }

            await using (var reopenedConnection = new SqliteConnection($"Data Source={filePath}"))
            {
                await reopenedConnection.OpenAsync();
                var options = new DbContextOptionsBuilder<WarehouseDbContext>()
                    .UseSqlite(reopenedConnection)
                    .Options;

                await using var context = new WarehouseDbContext(options);
                var applied = (await context.Database.GetAppliedMigrationsAsync()).ToArray();
                await context.Database.MigrateAsync();

                Assert.NotEmpty(applied);
                Assert.Equal(applied, (await context.Database.GetAppliedMigrationsAsync()).ToArray());
            }

            await using var memoryConnection = new SqliteConnection("Data Source=:memory:");
            await memoryConnection.OpenAsync();
            var memoryOptions = new DbContextOptionsBuilder<WarehouseDbContext>()
                .UseSqlite(memoryConnection)
                .Options;

            string[] memoryApplied;
            await using (var firstContext = new WarehouseDbContext(memoryOptions))
            {
                await firstContext.Database.MigrateAsync();
                memoryApplied = (await firstContext.Database.GetAppliedMigrationsAsync()).ToArray();
            }

            Assert.NotEmpty(memoryApplied);

            await using (var secondContext = new WarehouseDbContext(memoryOptions))
            {
                Assert.Equal(memoryApplied, (await secondContext.Database.GetAppliedMigrationsAsync()).ToArray());
                await secondContext.Database.MigrateAsync();
                Assert.Equal(memoryApplied, (await secondContext.Database.GetAppliedMigrationsAsync()).ToArray());
            }
        }
        finally
        {
            File.Delete(filePath);
        }
    }

    [Fact]
    public async Task Stock_positions_survive_sqlite_file_reopen_without_creating_missing_rows()
    {
        var filePath = Path.Combine(Path.GetTempPath(), $"token-warehouse-stock-{Guid.NewGuid():N}.db");

        try
        {
            await using (var connection = new SqliteConnection($"Data Source={filePath}"))
            {
                await connection.OpenAsync();
                var options = new DbContextOptionsBuilder<WarehouseDbContext>()
                    .UseSqlite(connection)
                    .Options;

                await using var context = new WarehouseDbContext(options);
                await context.Database.MigrateAsync();
                context.Articles.AddRange(
                    new ArticleEntity
                    {
                        Ean13 = "0123456789012",
                        Type = "food",
                        Name = "Article persistant",
                        NameSearchKey = "ARTICLE PERSISTANT",
                        PriceHtCents = 100,
                        IsActive = true,
                        Dlc = "2030-01-15",
                        ConsumptionModes = "takeaway"
                    },
                    new ArticleEntity
                    {
                        Ean13 = "7351353713578",
                        Type = "nonFood",
                        Name = "Article sans position",
                        NameSearchKey = "ARTICLE SANS POSITION",
                        PriceHtCents = 100,
                        IsActive = true,
                        Packaging = "new"
                    });
                context.StockPositions.Add(new StockPositionEntity
                {
                    Ean13 = "0123456789012",
                    PhysicalQuantity = 9
                });
                await context.SaveChangesAsync();
            }

            await using (var reopenedConnection = new SqliteConnection($"Data Source={filePath}"))
            {
                await reopenedConnection.OpenAsync();
                var options = new DbContextOptionsBuilder<WarehouseDbContext>()
                    .UseSqlite(reopenedConnection)
                    .Options;

                await using var context = new WarehouseDbContext(options);
                Assert.Equal(
                    9,
                    await context.StockPositions
                        .Where(position => position.Ean13 == "0123456789012")
                        .Select(position => position.PhysicalQuantity)
                        .SingleAsync());
                Assert.Equal(
                    0,
                    await context.StockPositions
                        .CountAsync(position => position.Ean13 == "7351353713578"));
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
    public async Task Stock_positions_reject_negative_quantities_and_duplicate_current_rows()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<WarehouseDbContext>()
            .UseSqlite(connection)
            .Options;

        await using (var context = new WarehouseDbContext(options))
        {
            await context.Database.MigrateAsync();
            context.Articles.AddRange(
                new ArticleEntity
                {
                    Ean13 = "0123456789012",
                    Type = "food",
                    Name = "Article positif",
                    NameSearchKey = "ARTICLE POSITIF",
                    PriceHtCents = 100,
                    IsActive = true,
                    Dlc = "2030-01-15",
                    ConsumptionModes = "takeaway"
                },
                new ArticleEntity
                {
                    Ean13 = "7351353713578",
                    Type = "nonFood",
                    Name = "Article négatif",
                    NameSearchKey = "ARTICLE NEGATIF",
                    PriceHtCents = 100,
                    IsActive = true,
                    Packaging = "new"
                });
            await context.SaveChangesAsync();

            context.StockPositions.Add(new StockPositionEntity
            {
                Ean13 = "0123456789012",
                PhysicalQuantity = 4
            });
            context.StockPositions.Add(new StockPositionEntity
            {
                Ean13 = "7351353713578",
                PhysicalQuantity = 0
            });
            await context.SaveChangesAsync();
        }

        await using (var duplicateContext = new WarehouseDbContext(options))
        {
            duplicateContext.StockPositions.Add(new StockPositionEntity
            {
                Ean13 = "0123456789012",
                PhysicalQuantity = 5
            });
            await Assert.ThrowsAsync<DbUpdateException>(() => duplicateContext.SaveChangesAsync());
        }

        await using (var negativeContext = new WarehouseDbContext(options))
        {
            negativeContext.StockPositions.Add(new StockPositionEntity
            {
                Ean13 = "7351353713578",
                PhysicalQuantity = -1
            });
            await Assert.ThrowsAsync<DbUpdateException>(() => negativeContext.SaveChangesAsync());
        }

        await using var readContext = new WarehouseDbContext(options);
        Assert.Equal(
            4,
            await readContext.StockPositions
                .Where(position => position.Ean13 == "0123456789012")
                .Select(position => position.PhysicalQuantity)
                .SingleAsync());
        Assert.Equal(
            0,
            await readContext.StockPositions
                .Where(position => position.Ean13 == "7351353713578")
                .Select(position => position.PhysicalQuantity)
                .SingleAsync());
    }

    [Fact]
    public async Task Stock_operations_enforce_positive_quantities_and_article_relations()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<WarehouseDbContext>()
            .UseSqlite(connection)
            .Options;

        await using (var context = new WarehouseDbContext(options))
        {
            await context.Database.MigrateAsync();
            context.Articles.Add(new ArticleEntity
            {
                Ean13 = "0123456789012",
                Type = "food",
                Name = "Article approvisionné",
                NameSearchKey = "ARTICLE APPROVISIONNE",
                PriceHtCents = 100,
                IsActive = true,
                Dlc = "2030-01-15",
                ConsumptionModes = "takeaway"
            });
            context.StockOperations.Add(new StockOperationEntity
            {
                Id = "operation-1",
                Type = "supply",
                Ean13 = "0123456789012",
                Quantity = 1,
                OccurredAt = "2030-01-15T10:00:00.0000000+00:00"
            });
            await context.SaveChangesAsync();
        }

        await using (var invalidQuantityContext = new WarehouseDbContext(options))
        {
            invalidQuantityContext.StockOperations.Add(new StockOperationEntity
            {
                Id = "operation-zero",
                Type = "supply",
                Ean13 = "0123456789012",
                Quantity = 0,
                OccurredAt = "2030-01-15T10:00:00.0000000+00:00"
            });
            await Assert.ThrowsAsync<DbUpdateException>(() => invalidQuantityContext.SaveChangesAsync());
        }

        await using (var orphanContext = new WarehouseDbContext(options))
        {
            orphanContext.StockOperations.Add(new StockOperationEntity
            {
                Id = "operation-orphan",
                Type = "supply",
                Ean13 = "7351353713578",
                Quantity = 1,
                OccurredAt = "2030-01-15T10:00:00.0000000+00:00"
            });
            await Assert.ThrowsAsync<DbUpdateException>(() => orphanContext.SaveChangesAsync());
        }

        await using var readContext = new WarehouseDbContext(options);
        Assert.Equal(1, await readContext.StockOperations.CountAsync());
    }

    [Fact]
    public async Task Supply_operation_lines_reject_zero_quantity_without_partial_rows()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<WarehouseDbContext>()
            .UseSqlite(connection)
            .Options;

        await using (var context = new WarehouseDbContext(options))
        {
            await context.Database.MigrateAsync();
            context.Articles.Add(new ArticleEntity
            {
                Ean13 = "0123456789012",
                Type = "food",
                Name = "Article approvisionné",
                NameSearchKey = "ARTICLE APPROVISIONNE",
                PriceHtCents = 100,
                IsActive = true,
                Dlc = "2030-01-15",
                ConsumptionModes = "takeaway"
            });
            context.StockPositions.Add(new StockPositionEntity
            {
                Ean13 = "0123456789012",
                PhysicalQuantity = 4
            });
            context.StockOperations.Add(new StockOperationEntity
            {
                Id = "operation-zero-line",
                Type = "supply",
                Ean13 = "0123456789012",
                Quantity = 1,
                OccurredAt = "2030-01-15T10:00:00.0000000+00:00"
            });
            context.StockOperationLines.Add(new StockOperationLineEntity
            {
                OperationId = "operation-zero-line",
                LineNumber = 1,
                Ean13 = "0123456789012",
                OperationType = "supply",
                Quantity = 0,
                PreviousPhysicalStock = 0,
                CountedQuantity = 0,
                InventoryDifference = 0,
                ResultingPhysicalStock = 0
            });

            await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
        }

        await using var readContext = new WarehouseDbContext(options);
        Assert.Equal(0, await readContext.StockPositions.CountAsync());
        Assert.Equal(0, await readContext.StockOperations.CountAsync());
        Assert.Equal(0, await readContext.StockOperationLines.CountAsync());
    }

    [Fact]
    public async Task Inventory_operation_lines_keep_zero_quantity_and_reject_operation_type_changes()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<WarehouseDbContext>()
            .UseSqlite(connection)
            .Options;

        await using (var context = new WarehouseDbContext(options))
        {
            await context.Database.MigrateAsync();
            context.Articles.Add(new ArticleEntity
            {
                Ean13 = "0123456789012",
                Type = "food",
                Name = "Article inventorié",
                NameSearchKey = "ARTICLE INVENTORIE",
                PriceHtCents = 100,
                IsActive = true,
                Dlc = "2030-01-15",
                ConsumptionModes = "takeaway"
            });
            var operation = new StockOperationEntity
            {
                Id = "operation-zero-inventory-line",
                Type = "INVENTORY",
                Ean13 = "0123456789012",
                Quantity = 0,
                OccurredAt = "2030-01-15T10:00:00.0000000+00:00"
            };
            context.StockOperations.Add(operation);
            context.StockOperationLines.Add(new StockOperationLineEntity
            {
                OperationId = operation.Id,
                LineNumber = 1,
                Ean13 = "0123456789012",
                OperationType = "INVENTORY",
                Quantity = 0,
                PreviousPhysicalStock = 0,
                CountedQuantity = 0,
                InventoryDifference = 0,
                ResultingPhysicalStock = 0
            });
            await context.SaveChangesAsync();

            operation.Type = "supply";
            operation.Quantity = 1;
            await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
        }

        await using var readContext = new WarehouseDbContext(options);
        var persistedLine = await readContext.StockOperationLines.SingleAsync();
        Assert.Equal("INVENTORY", persistedLine.OperationType);
        Assert.Equal(0, persistedLine.Quantity);
        Assert.Equal("INVENTORY", await readContext.StockOperations
            .Select(operation => operation.Type)
            .SingleAsync());
    }
}
