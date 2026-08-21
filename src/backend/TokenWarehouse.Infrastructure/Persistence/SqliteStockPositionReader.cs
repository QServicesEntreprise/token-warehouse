using Microsoft.EntityFrameworkCore;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteStockPositionReader(IDbContextFactory<WarehouseDbContext> contextFactory)
    : IStockPositionReader
{
    public async ValueTask<IReadOnlyList<StockPosition>> ListAsync(
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        var entities = await context.StockPositions
            .AsNoTracking()
            .OrderBy(position => position.Ean13)
            .ToListAsync(cancellationToken);
        var positions = new List<StockPosition>(entities.Count);

        foreach (var entity in entities)
        {
            if (ToDomain(entity) is { } position)
            {
                positions.Add(position);
            }
        }

        return positions;
    }

    public async ValueTask<StockPosition?> FindByEanAsync(
        Ean13 ean13,
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        var entity = await context.StockPositions
            .AsNoTracking()
            .SingleOrDefaultAsync(position => position.Ean13 == ean13.Value, cancellationToken);

        return entity is null ? null : ToDomain(entity);
    }

    public async ValueTask<IReadOnlyList<StockPosition>> FindByEansAsync(
        IReadOnlyList<Ean13> eans,
        CancellationToken cancellationToken = default)
    {
        var values = eans.Select(ean13 => ean13.Value).Distinct(StringComparer.Ordinal).ToArray();
        if (values.Length == 0)
        {
            return [];
        }

        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        var entities = await context.StockPositions
            .AsNoTracking()
            .Where(position => values.Contains(position.Ean13))
            .OrderBy(position => position.Ean13)
            .ToListAsync(cancellationToken);
        return entities
            .Select(ToDomain)
            .OfType<StockPosition>()
            .ToArray();
    }

    internal static StockPosition? ToDomain(StockPositionEntity entity)
        => Ean13.TryCreate(entity.Ean13, out var ean13)
            ? new StockPosition(ean13, entity.PhysicalQuantity, entity.Version)
            : null;
}
