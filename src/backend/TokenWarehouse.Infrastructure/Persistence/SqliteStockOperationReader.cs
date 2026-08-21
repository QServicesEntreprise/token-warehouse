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
            .Include(operation => operation.Lines)
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
                out var timestampUtc))
        {
            throw new InvalidOperationException("Stored StockOperation data is invalid.");
        }

        if (string.Equals(entity.Type, "supply", StringComparison.OrdinalIgnoreCase))
        {
            if (entity.Lines.Count == 0)
            {
                if (!Quantity.TryCreatePositive(entity.Quantity, out var quantity))
                {
                    throw new InvalidOperationException("Stored Supply data is invalid.");
                }

                return StockOperation.CreateSupply(entity.Id, ean13, quantity, timestampUtc);
            }

            var lines = entity.Lines
                .OrderBy(line => line.LineNumber)
                .Select(line =>
                {
                    if (!Ean13.TryCreate(line.Ean13, out var lineEan13)
                        || !Quantity.TryCreatePositive(line.Quantity, out var quantity))
                    {
                        throw new InvalidOperationException("Stored Supply line data is invalid.");
                    }

                    return new StockOperationLine(line.LineNumber, lineEan13, quantity);
                })
                .ToArray();
            return StockOperation.CreateBulkSupply(entity.Id, lines, timestampUtc);
        }

        if (!string.Equals(entity.Type, "INVENTORY", StringComparison.Ordinal))
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
