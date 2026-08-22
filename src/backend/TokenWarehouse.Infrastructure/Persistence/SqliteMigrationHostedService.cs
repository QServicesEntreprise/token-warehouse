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

    private static async Task SeedE2eStockArticlesAsync(
        WarehouseDbContext context,
        DateOnly today,
        CancellationToken cancellationToken)
    {
        var fixtureArticles = new[]
        {
            new ArticleEntity
            {
                Ean13 = "0123456789012",
                Type = "food",
                Name = "Alimentaire aux deux modes",
                NameSearchKey = ArticleNameSearchKey.From("Alimentaire aux deux modes"),
                PriceHtCents = 100,
                IsActive = true,
                Dlc = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                ConsumptionModes = "takeaway,onsite"
            },
            new ArticleEntity
            {
                Ean13 = "1234567890128",
                Type = "food",
                Name = "Alimentaire à DLC dépassée",
                NameSearchKey = ArticleNameSearchKey.From("Alimentaire à DLC dépassée"),
                PriceHtCents = 100,
                IsActive = true,
                Dlc = "2020-01-14",
                ConsumptionModes = "takeaway"
            },
            new ArticleEntity
            {
                Ean13 = "2345678901234",
                Type = "nonFood",
                Name = "Article archivé",
                NameSearchKey = ArticleNameSearchKey.From("Article archivé"),
                PriceHtCents = 100,
                IsActive = false,
                Packaging = "new"
            },
            new ArticleEntity
            {
                Ean13 = "3456789012340",
                Type = "nonFood",
                Name = "Non alimentaire au Packaging Invendable",
                NameSearchKey = ArticleNameSearchKey.From("Non alimentaire au Packaging Invendable"),
                PriceHtCents = 100,
                IsActive = true,
                Packaging = "unsellable"
            },
            new ArticleEntity
            {
                Ean13 = "4567890123456",
                Type = "nonFood",
                Name = "Article actif vendable",
                NameSearchKey = ArticleNameSearchKey.From("Article actif vendable"),
                PriceHtCents = 100,
                IsActive = true,
                Packaging = "new"
            },
            new ArticleEntity
            {
                Ean13 = "5678901234562",
                Type = "food",
                Name = "Article actif sans position",
                NameSearchKey = ArticleNameSearchKey.From("Article actif sans position"),
                PriceHtCents = 100,
                IsActive = true,
                Dlc = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                ConsumptionModes = "takeaway"
            }
        };

        foreach (var article in fixtureArticles)
        {
            if (!await context.Articles.AnyAsync(existing => existing.Ean13 == article.Ean13, cancellationToken))
            {
                context.Articles.Add(article);
            }
        }
        await context.SaveChangesAsync(cancellationToken);

        var physicalQuantities = new Dictionary<string, int>
        {
            ["0123456789012"] = 5,
            ["1234567890128"] = 7,
            ["2345678901234"] = 4,
            ["3456789012340"] = 3,
            ["4567890123456"] = 8
        };
        foreach (var (ean13, physicalQuantity) in physicalQuantities)
        {
            if (!await context.StockPositions.AnyAsync(position => position.Ean13 == ean13, cancellationToken))
            {
                context.StockPositions.Add(new StockPositionEntity
                {
                    Ean13 = ean13,
                    PhysicalQuantity = physicalQuantity
                });
            }
        }

        await context.SaveChangesAsync(cancellationToken);
    }
}
