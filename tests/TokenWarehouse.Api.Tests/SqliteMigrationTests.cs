using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TokenWarehouse.Infrastructure.Persistence;
using Xunit;

namespace TokenWarehouse.Api.Tests;

public sealed class SqliteMigrationTests
{
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
}
