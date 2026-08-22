using System.Data.Common;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;
using TokenWarehouse.Infrastructure.Persistence;
using Xunit;

namespace TokenWarehouse.Api.Tests;

public sealed class DashboardReadSourceTests
{
    [Fact]
    public async Task Reads_positions_and_operations_from_one_sqlite_snapshot()
    {
        var databasePath = Path.Combine(
            Path.GetTempPath(),
            $"token-warehouse-dashboard-snapshot-{Guid.NewGuid():N}.db");
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
                    Name = "Article de snapshot",
                    NameSearchKey = "ARTICLE DE SNAPSHOT",
                    PriceHtCents = 100,
                    IsActive = true,
                    Dlc = "2099-01-15",
                    ConsumptionModes = "takeaway"
                });
                setupContext.StockPositions.Add(new StockPositionEntity
                {
                    Ean13 = "0123456789012",
                    PhysicalQuantity = 5
                });
                await setupContext.SaveChangesAsync();
            }

            await using (var journalModeCommand = setupConnection.CreateCommand())
            {
                journalModeCommand.CommandText = "PRAGMA journal_mode=WAL";
                await journalModeCommand.ExecuteScalarAsync();
            }
            await setupConnection.CloseAsync();

            var interceptor = new InjectSupplyBeforeOperationsQuery(databasePath);
            var contextFactory = new DashboardDbContextFactory(
                $"Data Source={databasePath}",
                interceptor);
            var source = new SqliteCurrentDashboardReadSource(
                contextFactory,
                new SqliteStockReadReader(contextFactory),
                new SqliteStockOperationReader(contextFactory),
                new FixedClock());
            var query = new DashboardQuery(
                new WarehouseDateRange(new DateOnly(2030, 1, 1), new DateOnly(2030, 1, 31)),
                new DashboardArticleSelection(null, null, null));

            var snapshot = await source.ReadAsync(query);

            Assert.True(interceptor.WriterCommitted || interceptor.WriterBlocked);
            Assert.Equal(5, snapshot.Positions.Single().PhysicalQuantity);
            Assert.Empty(snapshot.Operations);
            if (interceptor.WriterBlocked)
            {
                interceptor.CommitPendingSupply();
            }

            var freshSnapshot = await source.ReadAsync(query);
            Assert.Contains(
                freshSnapshot.Operations,
                operation => operation.Id == "concurrent-supply");
            Assert.Equal(6, freshSnapshot.Positions.Single().PhysicalQuantity);
        }
        finally
        {
            File.Delete(databasePath);
            File.Delete($"{databasePath}-wal");
            File.Delete($"{databasePath}-shm");
        }
    }

    private sealed class DashboardDbContextFactory(
        string connectionString,
        DbCommandInterceptor? interceptor = null) : IDbContextFactory<WarehouseDbContext>
    {
        public WarehouseDbContext CreateDbContext() => Create();

        public Task<WarehouseDbContext> CreateDbContextAsync(
            CancellationToken cancellationToken = default)
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

    private sealed class FixedClock : IClock
    {
        public DateTimeOffset UtcNow => new(2030, 1, 15, 10, 0, 0, TimeSpan.Zero);
    }

    private sealed class InjectSupplyBeforeOperationsQuery(string databasePath) : DbCommandInterceptor
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
            if (writerAttempted
                || !command.CommandText.Contains("StockOperations", StringComparison.Ordinal))
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
            try
            {
                WriteSupply(context);
                WriterCommitted = true;
            }
            catch (DbUpdateException exception) when (exception.InnerException is SqliteException
            {
                SqliteErrorCode: 5 or 6
            })
            {
                WriterBlocked = true;
            }
            catch (SqliteException exception) when (exception.SqliteErrorCode is 5 or 6)
            {
                WriterBlocked = true;
            }
        }

        public void CommitPendingSupply()
        {
            using var connection = new SqliteConnection($"Data Source={databasePath}");
            connection.Open();
            var options = new DbContextOptionsBuilder<WarehouseDbContext>()
                .UseSqlite(connection)
                .Options;
            using var context = new WarehouseDbContext(options);
            WriteSupply(context);
        }

        private static void WriteSupply(WarehouseDbContext context)
        {
            context.StockOperations.Add(new StockOperationEntity
            {
                Id = "concurrent-supply",
                Type = "supply",
                Ean13 = "0123456789012",
                Quantity = 1,
                OccurredAt = "2030-01-15T12:00:00Z",
                TimestampUtc = "2030-01-15T12:00:00Z"
            });
            var position = context.StockPositions.Single(position => position.Ean13 == "0123456789012");
            position.PhysicalQuantity = 6;
            context.SaveChanges();
        }
    }
}
