using System.Net;
using System.Net.Http.Json;
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

public sealed class StockSaleContractTests
{
    private static readonly DateTimeOffset Now =
        new(2030, 1, 15, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Commits_a_sale_atomically_and_reloads_it_from_sqlite_without_a_sale_endpoint()
    {
        using var factory = new HostFactory(Now);
        using var client = factory.CreateClient();
        await factory.SeedAsync();

        using var scope = factory.Services.CreateScope();
        var contract = scope.ServiceProvider.GetRequiredService<IStockSaleContract>();
        var result = await contract.RecordAsync(new StockSaleCommand
        {
            Ean13 = "0123456789012",
            Quantity = 3
        });

        Assert.Equal(StockSaleStatus.Committed, result.Status);
        Assert.Equal(-3, result.Receipt?.Operation.Lines.Single().StockEffect);
        Assert.Equal(5, result.Receipt?.Position.PhysicalQuantity);

        var state = await factory.ReadFreshAsync(async context => new
        {
            Operation = await context.StockOperations
                .AsNoTracking()
                .Include(operation => operation.Lines)
                .SingleAsync(operation => operation.Type == "SALE"),
            Position = await context.StockPositions
                .AsNoTracking()
                .SingleAsync(position => position.Ean13 == "0123456789012")
        });
        Assert.Equal(3, state.Operation.Quantity);
        Assert.Equal("0123456789012", state.Operation.Ean13);
        Assert.Equal(-3, state.Operation.Lines.Single().SourceEffect);
        Assert.Equal(5, state.Position.PhysicalQuantity);

        var beforeReads = await factory.ReadFreshAsync(async context => new
        {
            Operations = await context.StockOperations.CountAsync(),
            Positions = await context.StockPositions.CountAsync()
        });
        var positions = await scope.ServiceProvider
            .GetRequiredService<IStockPositionReadContract>()
            .ListAsync();
        var operations = await scope.ServiceProvider
            .GetRequiredService<IStockOperationReadContract>()
            .ListAsync();
        var repeatedOperations = await scope.ServiceProvider
            .GetRequiredService<IStockOperationReadContract>()
            .ListAsync();
        var afterReads = await factory.ReadFreshAsync(async context => new
        {
            Operations = await context.StockOperations.CountAsync(),
            Positions = await context.StockPositions.CountAsync()
        });
        Assert.Equal(StockReadStatus.Success, positions.Status);
        Assert.Equal(5, positions.Positions.Single().PhysicalQuantity);
        Assert.Equal(StockOperationReadStatus.Success, operations.Status);
        Assert.Single(operations.Operations);
        Assert.Equal("SALE", operations.Operations[0].Type.ToString().ToUpperInvariant());
        Assert.Equal(-3, operations.Operations[0].Lines.Single().StockEffect);
        Assert.Equal(
            operations.Operations.Select(operation => operation.Id),
            repeatedOperations.Operations.Select(operation => operation.Id));
        Assert.Equal(beforeReads, afterReads);

        using var saleEndpoint = await client.PostAsJsonAsync(
            "/api/sales",
            new { ean13 = "0123456789012", quantity = 1 });
        Assert.Equal(HttpStatusCode.NotFound, saleEndpoint.StatusCode);
    }

    [Fact]
    public async Task Rejects_unknown_archived_expired_unsellable_and_insufficient_sales_without_writes()
    {
        using var factory = new HostFactory(Now);
        await factory.SeedAsync();
        await factory.SeedArticleAsync(
            "4006381333931",
            "archived",
            isActive: false,
            dlc: "2030-01-15",
            physicalQuantity: 4);
        await factory.SeedArticleAsync(
            "7351353713578",
            "expired",
            dlc: "2030-01-14",
            physicalQuantity: 4);
        await factory.SeedArticleAsync(
            "5901234123457",
            "unsellable",
            type: "nonFood",
            packaging: "unsellable",
            physicalQuantity: 4);
        await factory.SeedArticleAsync(
            "5012345678900",
            "insufficient",
            physicalQuantity: 2);

        using var scope = factory.Services.CreateScope();
        var contract = scope.ServiceProvider.GetRequiredService<IStockSaleContract>();
        var cases = new[]
        {
            ("4006381333931", StockSaleStatus.NotSellable),
            ("7351353713578", StockSaleStatus.NotSellable),
            ("5901234123457", StockSaleStatus.NotSellable),
            ("5012345678900", StockSaleStatus.OutOfStock),
            ("5012345678917", StockSaleStatus.ArticleNotFound)
        };

        foreach (var (ean13, expectedStatus) in cases)
        {
            var result = await contract.RecordAsync(new StockSaleCommand
            {
                Ean13 = ean13,
                Quantity = 3
            });

            Assert.Equal(expectedStatus, result.Status);
            Assert.Null(result.Receipt);
            Assert.NotEmpty(result.Errors);
            Assert.Equal(0, await factory.ReadFreshAsync(context => context.StockOperations.CountAsync()));
        }
    }

    [Fact]
    public async Task Rejects_a_sale_plan_when_the_position_changed_after_verification()
    {
        using var factory = new HostFactory(Now);
        await factory.SeedAsync();

        using var scope = factory.Services.CreateScope();
        var article = await scope.ServiceProvider
            .GetRequiredService<IArticleSellabilityReader>()
            .FindSellabilityByEanAsync(ParseEan("0123456789012"));
        var currentPosition = await scope.ServiceProvider
            .GetRequiredService<IStockPositionReader>()
            .FindByEanAsync(ParseEan("0123456789012"));
        var operation = StockOperation.CreateSale(
            "stale-sale",
            ParseEan("0123456789012"),
            new Quantity(3),
            Now);
        await factory.UpdatePositionAsync(5, 3);

        var commit = await scope.ServiceProvider
            .GetRequiredService<IStockMutationCommitter>()
            .CommitAsync(new StockSaleCommitPlan(
                article!,
                currentPosition,
                currentPosition!.ApplyEffect(-3),
                operation,
                new DateOnly(2030, 1, 15)));

        Assert.Equal(StockMutationCommitStatus.Conflict, commit.Status);
        var state = await factory.ReadFreshAsync(async context => new
        {
            Operations = await context.StockOperations.CountAsync(),
            Position = await context.StockPositions.SingleAsync()
        });
        Assert.Equal(0, state.Operations);
        Assert.Equal(5, state.Position.PhysicalQuantity);
        Assert.Equal(3, state.Position.Version);
    }

    [Fact]
    public async Task Revalidates_the_current_article_policy_before_committing()
    {
        using var factory = new HostFactory(Now);
        await factory.SeedAsync();

        using var scope = factory.Services.CreateScope();
        var article = await scope.ServiceProvider
            .GetRequiredService<IArticleSellabilityReader>()
            .FindSellabilityByEanAsync(ParseEan("0123456789012"));
        var currentPosition = await scope.ServiceProvider
            .GetRequiredService<IStockPositionReader>()
            .FindByEanAsync(ParseEan("0123456789012"));
        var operation = StockOperation.CreateSale(
            "archived-sale",
            ParseEan("0123456789012"),
            new Quantity(3),
            Now);
        await factory.ArchiveArticleAsync();

        var commit = await scope.ServiceProvider
            .GetRequiredService<IStockMutationCommitter>()
            .CommitAsync(new StockSaleCommitPlan(
                article!,
                currentPosition,
                currentPosition!.ApplyEffect(-3),
                operation,
                new DateOnly(2030, 1, 15)));

        Assert.Equal(StockMutationCommitStatus.Conflict, commit.Status);
        var state = await factory.ReadFreshAsync(async context => new
        {
            Article = await context.Articles.SingleAsync(),
            Operations = await context.StockOperations.CountAsync(),
            Position = await context.StockPositions.SingleAsync()
        });
        Assert.False(state.Article.IsActive);
        Assert.Equal(0, state.Operations);
        Assert.Equal(8, state.Position.PhysicalQuantity);
        Assert.Equal(2, state.Position.Version);
    }

    private static Ean13 ParseEan(string value)
    {
        Assert.True(Ean13.TryCreate(value, out var ean13));
        return ean13;
    }

    private sealed class HostFactory(DateTimeOffset now) : WebApplicationFactory<Program>
    {
        private readonly string databasePath = Path.Combine(
            Path.GetTempPath(),
            $"token-warehouse-sale-{Guid.NewGuid():N}.db");

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:Warehouse", $"Data Source={databasePath}");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IClock>();
                services.AddSingleton<IClock>(new FixedClock(now));
            });
        }

        public Task SeedAsync()
            => SeedArticleAsync(
                "0123456789012",
                "Article vendable",
                dlc: "2030-01-15",
                physicalQuantity: 8,
                positionVersion: 2);

        public async Task SeedArticleAsync(
            string ean13,
            string name,
            string type = "food",
            bool isActive = true,
            string? dlc = null,
            string? packaging = null,
            int physicalQuantity = 0,
            int positionVersion = 0)
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            context.Articles.Add(new ArticleEntity
            {
                Ean13 = ean13,
                Type = type,
                Name = name,
                NameSearchKey = name.ToLowerInvariant(),
                PriceHtCents = 1000,
                IsActive = isActive,
                Version = 0,
                Dlc = dlc,
                ConsumptionModes = type == "food" ? "takeaway" : null,
                Packaging = packaging
            });
            context.StockPositions.Add(new StockPositionEntity
            {
                Ean13 = ean13,
                PhysicalQuantity = physicalQuantity,
                Version = positionVersion
            });
            await context.SaveChangesAsync();
        }

        public async Task UpdatePositionAsync(int physicalQuantity, int version)
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            var position = await context.StockPositions.SingleAsync();
            position.PhysicalQuantity = physicalQuantity;
            position.Version = version;
            await context.SaveChangesAsync();
        }

        public async Task ArchiveArticleAsync()
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            var article = await context.Articles.SingleAsync();
            article.IsActive = false;
            article.Version++;
            await context.SaveChangesAsync();
        }

        public async Task<T> ReadFreshAsync<T>(Func<WarehouseDbContext, Task<T>> read)
        {
            await using var connection = new SqliteConnection($"Data Source={databasePath}");
            await connection.OpenAsync();
            var options = new DbContextOptionsBuilder<WarehouseDbContext>()
                .UseSqlite(connection)
                .Options;
            await using var context = new WarehouseDbContext(options);
            return await read(context);
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

    private sealed class FixedClock(DateTimeOffset now) : IClock
    {
        public DateTimeOffset UtcNow => now;
    }

}
