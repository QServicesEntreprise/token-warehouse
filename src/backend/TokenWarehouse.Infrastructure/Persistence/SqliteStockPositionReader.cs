using Microsoft.EntityFrameworkCore;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteStockPositionReader(IDbContextFactory<WarehouseDbContext> contextFactory)
    : IStockPositionReader
{
    public async ValueTask<StockPosition?> FindByEanAsync(
        Ean13 ean13,
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        var entity = await context.StockPositions
            .AsNoTracking()
            .SingleOrDefaultAsync(position => position.Ean13 == ean13.Value, cancellationToken);

        return entity is null
            ? null
            : new StockPosition(ean13, entity.PhysicalQuantity);
    }
}
