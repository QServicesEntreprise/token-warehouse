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

    public async ValueTask<StockOperation?> FindCounterMovementBySourceIdAsync(
        string sourceOperationId,
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        var entity = await context.StockOperations
            .AsNoTracking()
            .Include(operation => operation.Lines)
            .SingleOrDefaultAsync(
                operation => operation.SourceOperationId == sourceOperationId
                    && operation.Type == "COUNTER_MOVEMENT",
                cancellationToken);
        if (entity is null)
        {
            return null;
        }

        var lines = await context.StockOperationLines
            .AsNoTracking()
            .Where(line => line.OperationId == entity.Id)
            .OrderBy(line => line.LineNumber)
            .ToListAsync(cancellationToken);
        return ToDomain(entity, lines);
    }

    public async ValueTask<IReadOnlyList<StockOperation>> ListAsync(
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        var entities = await context.StockOperations
            .AsNoTracking()
            .Include(operation => operation.Lines)
            .ToListAsync(cancellationToken);

        return entities
            .Select(entity => ToDomain(
                entity,
                entity.Lines.OrderBy(line => line.LineNumber).ToArray()))
            .OrderBy(operation => operation.TimestampUtc)
            .ThenBy(operation => operation.Id, StringComparer.Ordinal)
            .ToArray();
    }

    public async ValueTask<IReadOnlyList<StockOperationReadFact>> ListForDashboardAsync(
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        return await ListForDashboardInSessionAsync(context, cancellationToken);
    }

    internal async Task<IReadOnlyList<StockOperationReadFact>> ListForDashboardInSessionAsync(
        WarehouseDbContext context,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(context);

        var entities = await context.StockOperations
            .AsNoTracking()
            .Include(operation => operation.Lines)
            .Where(operation => operation.Type == "supply" || operation.Type == "SALE")
            .ToListAsync(cancellationToken);

        return entities
            .Select(entity => new StockOperationReadFact(
                ToDomain(entity, entity.Lines.OrderBy(line => line.LineNumber).ToArray()),
                ReadSaleContext(entity)))
            .OrderBy(fact => fact.Operation.TimestampUtc)
            .ThenBy(fact => fact.Operation.Id, StringComparer.Ordinal)
            .ToArray();
    }

    public async ValueTask<IReadOnlyList<StockOperation>> ListCorrectableAsync(
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        var entities = await context.StockOperations
            .AsNoTracking()
            .Include(operation => operation.Lines)
            .Where(operation => operation.Type == "supply"
                || operation.Type == "INVENTORY"
                || operation.Type == "SALE")
            .Where(operation => !context.StockOperations.Any(counter =>
                counter.Type == "COUNTER_MOVEMENT"
                && counter.SourceOperationId == operation.Id))
            .OrderBy(operation => operation.TimestampUtc)
            .ThenBy(operation => operation.Id)
            .ToListAsync(cancellationToken);

        return entities
            .Select(entity => ToDomain(
                entity,
                entity.Lines.OrderBy(line => line.LineNumber).ToArray()))
            .ToArray();
    }

    private static StockOperation ToDomain(
        StockOperationEntity entity,
        IReadOnlyList<StockOperationLineEntity> lineEntities)
    {
        if (!Ean13.TryCreate(entity.Ean13, out var operationEan13)
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
            if (lineEntities.Count == 0)
            {
                if (!Quantity.TryCreatePositive(entity.Quantity, out var quantity))
                {
                    throw new InvalidOperationException("Stored Supply data is invalid.");
                }

                return StockOperation.CreateSupply(entity.Id, operationEan13, quantity, timestampUtc);
            }

            var supplyLines = lineEntities
                .OrderBy(line => line.LineNumber)
                .Select(line =>
                {
                    if (!Ean13.TryCreate(line.Ean13, out var lineEan13)
                        || !Quantity.TryCreatePositive(line.Quantity, out var quantity)
                        || line.SourceEffect != line.Quantity)
                    {
                        throw new InvalidOperationException("Stored Supply line data is invalid.");
                    }

                    return new StockOperationLine(line.LineNumber, lineEan13, quantity);
                })
                .ToArray();
            return StockOperation.CreateBulkSupply(entity.Id, supplyLines, timestampUtc);
        }

        if (string.Equals(entity.Type, "SALE", StringComparison.OrdinalIgnoreCase))
        {
            if (!Quantity.TryCreatePositive(entity.Quantity, out var quantity))
            {
                throw new InvalidOperationException("Stored Sale data is invalid.");
            }

            if (lineEntities.Count > 0
                && (lineEntities.Count != 1
                    || lineEntities[0].LineNumber != 1
                    || lineEntities[0].Ean13 != operationEan13.Value
                    || lineEntities[0].Quantity != quantity.Value
                    || lineEntities[0].SourceEffect != -quantity.Value))
            {
                throw new InvalidOperationException("Stored Sale line data is invalid.");
            }

            return StockOperation.CreateSale(entity.Id, operationEan13, quantity, timestampUtc);
        }

        if (string.Equals(entity.Type, "COUNTER_MOVEMENT", StringComparison.Ordinal))
        {
            if (string.IsNullOrWhiteSpace(entity.SourceOperationId)
                || string.IsNullOrWhiteSpace(entity.Justification)
                || !Enum.TryParse<StockOperationType>(
                    entity.SourceOperationType,
                    ignoreCase: true,
                    out var sourceType))
            {
                throw new InvalidOperationException("Stored CounterMovement data is invalid.");
            }

            var counterLines = lineEntities
                .Select(line =>
                {
                    if (!Ean13.TryCreate(line.Ean13, out var ean13)
                        || line.SourceEffect == int.MinValue
                        || line.InverseEffect != -line.SourceEffect)
                    {
                        throw new InvalidOperationException("Stored CounterMovement line data is invalid.");
                    }

                    return new CounterMovementLinePlan(
                        ean13,
                        line.SourceEffect,
                        line.InverseEffect,
                        0,
                        0,
                        0);
                })
                .ToArray();
            return StockOperation.CreateCounterMovement(
                entity.Id,
                entity.SourceOperationId,
                sourceType,
                entity.Justification,
                counterLines,
                timestampUtc);
        }

        if (!string.Equals(entity.Type, "INVENTORY", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Stored StockOperation data is invalid.");
        }

        if (lineEntities.Count == 0)
        {
            return StockOperation.CreateInventory(
                entity.Id,
                operationEan13,
                InventoryReconciliation.Reconcile(
                    entity.PreviousPhysicalStock,
                    entity.CountedQuantity),
                timestampUtc);
        }

        var inventoryLines = lineEntities
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
                    || reconciliation.ResultingPhysicalStock != line.ResultingPhysicalStock
                    || line.SourceEffect != reconciliation.InventoryDifference)
                {
                    throw new InvalidOperationException("Stored Inventory data is invalid.");
                }

                return StockOperationLine.CreateInventoryLine(
                    line.LineNumber,
                    ean13,
                    reconciliation);
            })
            .ToArray();

        return StockOperation.CreateInventory(entity.Id, inventoryLines, timestampUtc);
    }

    private static SaleContext? ReadSaleContext(StockOperationEntity entity)
        => string.Equals(entity.Type, "SALE", StringComparison.OrdinalIgnoreCase)
            && SaleFinancialSnapshotSerializer.TryDeserialize(
                entity.SaleCommitDataType,
                entity.SaleCommitDataPayload,
                out var financial)
            ? financial.SaleContext
            : null;
}
