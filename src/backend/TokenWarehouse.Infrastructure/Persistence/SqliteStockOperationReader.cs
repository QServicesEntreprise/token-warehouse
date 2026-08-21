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

        return entity is null ? null : ToDomain(entity);
    }

    private static StockOperation ToDomain(StockOperationEntity entity)
    {
        if (!Ean13.TryCreate(entity.Ean13, out var ean13)
            || !DateTimeOffset.TryParse(
                entity.TimestampUtc,
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind,
                out var timestampUtc)
            || !string.Equals(entity.Type, "INVENTORY", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Stored StockOperation data is invalid.");
        }

        var reconciliation = InventoryReconciliation.Reconcile(
            entity.PreviousPhysicalStock,
            entity.CountedQuantity);
        if (reconciliation.InventoryDifference != entity.InventoryDifference
            || reconciliation.ResultingPhysicalStock != entity.ResultingPhysicalStock)
        {
            throw new InvalidOperationException("Stored Inventory data is invalid.");
        }

        return StockOperation.CreateInventory(
            entity.Id,
            ean13,
            reconciliation,
            timestampUtc);
    }
}
