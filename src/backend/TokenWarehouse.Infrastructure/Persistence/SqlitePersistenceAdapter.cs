using Microsoft.EntityFrameworkCore;
using TokenWarehouse.Application;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqlitePersistenceAdapter(IDbContextFactory<WarehouseDbContext> contextFactory) : IPersistenceAdapter
{
    public string Provider => "sqlite";

    public async ValueTask<PersistenceStatus> CheckAsync(CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        var isReady = await context.Database.CanConnectAsync(cancellationToken);
        return new PersistenceStatus(isReady, Provider);
    }
}
