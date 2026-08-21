using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using System.Globalization;
using TokenWarehouse.Application;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteMigrationHostedService(
    IDbContextFactory<WarehouseDbContext> contextFactory,
    IPersistenceAdapter persistence,
    IHostEnvironment environment,
    IClock clock) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        if (!string.Equals(persistence.Provider, "sqlite", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        await context.Database.MigrateAsync(cancellationToken);
        await BackfillNameSearchKeysAsync(context, cancellationToken);

        if (environment.IsEnvironment("Testing")
            && string.Equals(
                Environment.GetEnvironmentVariable("TOKEN_WAREHOUSE_E2E_SEED"),
                "true",
                StringComparison.OrdinalIgnoreCase))
        {
            await SeedArchivedArticlesAsync(context, cancellationToken);
            await SeedE2eStockArticlesAsync(context, clock.WarehouseDate, cancellationToken);
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private static async Task BackfillNameSearchKeysAsync(
        WarehouseDbContext context,
        CancellationToken cancellationToken)
    {
        var articles = await context.Articles
            .Where(article => article.NameSearchKey == string.Empty)
            .ToListAsync(cancellationToken);

        if (articles.Count == 0)
        {
            return;
        }

        foreach (var article in articles)
        {
            article.NameSearchKey = ArticleNameSearchKey.From(article.Name);
        }

        await context.SaveChangesAsync(cancellationToken);
    }

    private static async Task SeedArchivedArticlesAsync(
        WarehouseDbContext context,
        CancellationToken cancellationToken)
    {
        if (await context.Articles.AnyAsync(article => !article.IsActive, cancellationToken))
        {
            return;
        }

        context.Articles.AddRange(
            new ArticleEntity
            {
                Ean13 = "5901234123457",
                Type = "food",
                Name = "Biscuit historique",
                NameSearchKey = ArticleNameSearchKey.From("Biscuit historique"),
                PriceHtCents = 299,
                IsActive = false,
                Dlc = "2026-12-31",
                ConsumptionModes = "takeaway"
            },
            new ArticleEntity
            {
                Ean13 = "5012345678900",
                Type = "nonFood",
                Name = "Lampe historique",
                NameSearchKey = ArticleNameSearchKey.From("Lampe historique"),
                PriceHtCents = 2900,
                IsActive = false,
                Packaging = "refurbished"
            });
        await context.SaveChangesAsync(cancellationToken);
    }

    private static async Task SeedE2eStockArticlesAsync(
        WarehouseDbContext context,
        DateOnly today,
        CancellationToken cancellationToken)
    {
        const string foodEan = "0123456789012";
        const string nonFoodEan = "4012345678901";
        const string inventoryEan = "7351353713578";

        if (!await context.Articles.AnyAsync(article => article.Ean13 == foodEan, cancellationToken))
        {
            context.Articles.Add(new ArticleEntity
            {
                Ean13 = foodEan,
                Type = "food",
                Name = "DLC de démonstration",
                NameSearchKey = ArticleNameSearchKey.From("DLC de démonstration"),
                PriceHtCents = 100,
                IsActive = true,
                Dlc = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                ConsumptionModes = "takeaway,onsite"
            });
        }

        if (!await context.Articles.AnyAsync(article => article.Ean13 == nonFoodEan, cancellationToken))
        {
            context.Articles.Add(new ArticleEntity
            {
                Ean13 = nonFoodEan,
                Type = "nonFood",
                Name = "Packaging de démonstration",
                NameSearchKey = ArticleNameSearchKey.From("Packaging de démonstration"),
                PriceHtCents = 200,
                IsActive = true,
                Packaging = "new"
            });
        }

        if (!await context.Articles.AnyAsync(article => article.Ean13 == inventoryEan, cancellationToken))
        {
            context.Articles.Add(new ArticleEntity
            {
                Ean13 = inventoryEan,
                Type = "food",
                Name = "Inventaire de démonstration",
                NameSearchKey = ArticleNameSearchKey.From("Inventaire de démonstration"),
                PriceHtCents = 100,
                IsActive = true,
                Dlc = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                ConsumptionModes = "takeaway"
            });
        }

        var stockFixtureArticles = new[]
        {
            new ArticleEntity
            {
                Ean13 = "1234567890128",
                Type = "food",
                Name = "Alimentaire expiré",
                NameSearchKey = ArticleNameSearchKey.From("Alimentaire expiré"),
                PriceHtCents = 100,
                IsActive = true,
                Dlc = "2020-01-14",
                ConsumptionModes = "takeaway"
            },
            new ArticleEntity
            {
                Ean13 = "0360002914522",
                Type = "food",
                Name = "Article sans position",
                NameSearchKey = ArticleNameSearchKey.From("Article sans position"),
                PriceHtCents = 100,
                IsActive = true,
                Dlc = "2099-01-15",
                ConsumptionModes = "takeaway"
            },
            new ArticleEntity
            {
                Ean13 = "9876543210982",
                Type = "nonFood",
                Name = "Article vendable",
                NameSearchKey = ArticleNameSearchKey.From("Article vendable"),
                PriceHtCents = 100,
                IsActive = true,
                Packaging = "new"
            },
            new ArticleEntity
            {
                Ean13 = "1111111111116",
                Type = "nonFood",
                Name = "Packaging invendable",
                NameSearchKey = ArticleNameSearchKey.From("Packaging invendable"),
                PriceHtCents = 100,
                IsActive = true,
                Packaging = "unsellable"
            }
        };

        foreach (var article in stockFixtureArticles)
        {
            if (!await context.Articles.AnyAsync(existing => existing.Ean13 == article.Ean13, cancellationToken))
            {
                context.Articles.Add(article);
            }
        }

        if (await context.Articles.AnyAsync(article => article.Ean13 == "5901234123457", cancellationToken)
            && !await context.StockPositions.AnyAsync(position => position.Ean13 == "5901234123457", cancellationToken))
        {
            context.StockPositions.Add(new StockPositionEntity
            {
                Ean13 = "5901234123457",
                PhysicalQuantity = 4
            });
        }

        if (await context.Articles.AnyAsync(article => article.Ean13 == "5012345678900", cancellationToken)
            && !await context.StockPositions.AnyAsync(position => position.Ean13 == "5012345678900", cancellationToken))
        {
            context.StockPositions.Add(new StockPositionEntity
            {
                Ean13 = "5012345678900",
                PhysicalQuantity = 4
            });
        }

        if (!await context.StockPositions.AnyAsync(position => position.Ean13 == "1234567890128", cancellationToken))
        {
            context.StockPositions.Add(new StockPositionEntity
            {
                Ean13 = "1234567890128",
                PhysicalQuantity = 7
            });
        }

        if (!await context.StockPositions.AnyAsync(position => position.Ean13 == "9876543210982", cancellationToken))
        {
            context.StockPositions.Add(new StockPositionEntity
            {
                Ean13 = "9876543210982",
                PhysicalQuantity = 8
            });
        }

        if (!await context.StockPositions.AnyAsync(position => position.Ean13 == "1111111111116", cancellationToken))
        {
            context.StockPositions.Add(new StockPositionEntity
            {
                Ean13 = "1111111111116",
                PhysicalQuantity = 3
            });
        }

        if (!await context.StockPositions.AnyAsync(position => position.Ean13 == foodEan, cancellationToken))
        {
            context.StockPositions.Add(new StockPositionEntity
            {
                Ean13 = foodEan,
                PhysicalQuantity = 8
            });
        }

        if (!await context.StockPositions.AnyAsync(position => position.Ean13 == nonFoodEan, cancellationToken))
        {
            context.StockPositions.Add(new StockPositionEntity
            {
                Ean13 = nonFoodEan,
                PhysicalQuantity = 7
            });
        }

        if (!await context.StockPositions.AnyAsync(position => position.Ean13 == inventoryEan, cancellationToken))
        {
            context.StockPositions.Add(new StockPositionEntity
            {
                Ean13 = inventoryEan,
                PhysicalQuantity = 8
            });
        }

        await context.SaveChangesAsync(cancellationToken);
    }
}
