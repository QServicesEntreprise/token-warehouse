using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using TokenWarehouse.Application;

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
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
