using System.Globalization;
using Microsoft.EntityFrameworkCore;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteStockOperationReader(
    IDbContextFactory<WarehouseDbContext> contextFactory) : IStockOperationReader
{
    public async ValueTask<StockOperation?> FindByIdAsync(
        string id,
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        var entity = await context.StockOperations
            .AsNoTracking()
            .SingleOrDefaultAsync(operation => operation.Id == id, cancellationToken);
        if (entity is null)
        {
            return null;
        }

        var lines = await context.StockOperationLines
            .AsNoTracking()
            .Where(line => line.OperationId == id)
            .OrderBy(line => line.LineNumber)
            .ToListAsync(cancellationToken);
        return ToDomain(entity, lines);
    }

    private static StockOperation ToDomain(
        StockOperationEntity entity,
        IReadOnlyList<StockOperationLineEntity> lineEntities)
    {
        if (!DateTimeOffset.TryParse(
                entity.TimestampUtc,
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind,
                out var timestampUtc)
            || !string.Equals(entity.Type, "INVENTORY", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Stored StockOperation data is invalid.");
        }

        if (lineEntities.Count == 0)
        {
            if (!Ean13.TryCreate(entity.Ean13, out var ean13))
            {
                throw new InvalidOperationException("Stored StockOperation data is invalid.");
            }

            return StockOperation.CreateInventory(
                entity.Id,
                ean13,
                InventoryReconciliation.Reconcile(
                    entity.PreviousPhysicalStock,
                    entity.CountedQuantity),
                timestampUtc);
        }

        var lines = lineEntities
            .Select(line =>
            {
                if (!Ean13.TryCreate(line.Ean13, out var ean13))
                {
                    throw new InvalidOperationException("Stored Inventory data is invalid.");
                }

                var reconciliation = InventoryReconciliation.Reconcile(
                    line.PreviousPhysicalStock,
                    line.CountedQuantity);
                if (reconciliation.InventoryDifference != line.InventoryDifference
                    || reconciliation.ResultingPhysicalStock != line.ResultingPhysicalStock)
                {
                    throw new InvalidOperationException("Stored Inventory data is invalid.");
                }

                return StockOperationLine.CreateInventoryLine(
                    line.LineNumber,
                    ean13,
                    reconciliation);
            })
            .ToArray();

        return StockOperation.CreateInventory(entity.Id, lines, timestampUtc);
    }
}
