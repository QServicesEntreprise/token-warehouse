using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteMigrationHostedService(
    IDbContextFactory<WarehouseDbContext> contextFactory,
    IPersistenceAdapter persistence) : IHostedService
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
}
