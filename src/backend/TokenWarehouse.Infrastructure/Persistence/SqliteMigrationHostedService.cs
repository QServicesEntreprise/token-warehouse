using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using TokenWarehouse.Application;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteMigrationHostedService(
    IDbContextFactory<WarehouseDbContext> contextFactory,
    IPersistenceAdapter persistence,
    IHostEnvironment environment) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        if (!string.Equals(persistence.Provider, "sqlite", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        await context.Database.MigrateAsync(cancellationToken);

        if (environment.IsEnvironment("Testing")
            && string.Equals(
                Environment.GetEnvironmentVariable("TOKEN_WAREHOUSE_E2E_SEED"),
                "true",
                StringComparison.OrdinalIgnoreCase))
        {
            await SeedArchivedArticlesAsync(context, cancellationToken);
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

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
                PriceHtCents = 2900,
                IsActive = false,
                Packaging = "refurbished"
            });
        await context.SaveChangesAsync(cancellationToken);
    }
}
