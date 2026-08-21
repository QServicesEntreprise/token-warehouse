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
}
