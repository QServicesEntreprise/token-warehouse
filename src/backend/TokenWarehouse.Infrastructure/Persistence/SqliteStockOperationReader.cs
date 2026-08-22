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
        return ReadOperation(entity, lines).Operation;
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
        return ReadOperation(entity, lines).Operation;
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
            .Select(entity => ReadOperation(
                entity,
                entity.Lines.OrderBy(line => line.LineNumber).ToArray()).Operation)
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

    public async ValueTask<IReadOnlyList<StockOperationReadFact>> ListForFinancialAsync(
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        var entities = await context.StockOperations
            .AsNoTracking()
            .Include(operation => operation.Lines)
            .Where(operation => operation.Type == "SALE"
                || operation.Type == "COUNTER_MOVEMENT")
            .ToListAsync(cancellationToken);

        return entities
            .Select(ToFinancialReadFact)
            .OrderBy(fact => fact.Operation.TimestampUtc)
            .ThenBy(fact => fact.Operation.Id, StringComparer.Ordinal)
            .ToArray();
    }

    internal async Task<IReadOnlyList<StockOperationReadFact>> ListForDashboardInSessionAsync(
        WarehouseDbContext context,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(context);

        var entities = await context.StockOperations
            .AsNoTracking()
            .Include(operation => operation.Lines)
            .Where(operation => operation.Type == "supply"
                || operation.Type == "SALE"
                || operation.Type == "COUNTER_MOVEMENT")
            .ToListAsync(cancellationToken);

        return entities
            .Select(entity =>
            {
                var read = ReadOperation(entity, entity.Lines.OrderBy(line => line.LineNumber).ToArray());
                return new StockOperationReadFact(read.Operation, read.Financial?.SaleContext);
            })
            .OrderBy(fact => fact.Operation.TimestampUtc)
            .ThenBy(fact => fact.Operation.Id, StringComparer.Ordinal)
            .ToArray();
    }

    private static StockOperationReadFact ToFinancialReadFact(StockOperationEntity entity)
    {
        var read = ReadOperation(
            entity,
            entity.Lines.OrderBy(line => line.LineNumber).ToArray(),
            requireFinancial: true);
        return new(
            read.Operation,
            read.Financial?.SaleContext,
            read.Financial,
            read.Operation.FinancialReversal);
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
            .Select(entity => ReadOperation(
                entity,
                entity.Lines.OrderBy(line => line.LineNumber).ToArray()).Operation)
            .ToArray();
    }

    private static (StockOperation Operation, SaleFinancialSnapshot? Financial) ReadOperation(
        StockOperationEntity entity,
        IReadOnlyList<StockOperationLineEntity> lineEntities,
        bool requireFinancial = false)
    {
        var operation = ToDomain(entity, lineEntities);
        var financial = operation.Type == StockOperationType.Sale
            ? ReadSaleFinancialSnapshot(entity, requireFinancial)
            : null;
        return (operation, financial);
    }

    private static SaleFinancialSnapshot? ReadSaleFinancialSnapshot(
        StockOperationEntity entity,
        bool required)
    {
        if (!string.Equals(entity.Type, "SALE", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        if (!string.Equals(
                entity.SaleCommitDataType,
                SaleFinancialSnapshotSerializer.Type,
                StringComparison.Ordinal))
        {
            if (required)
            {
                throw new InvalidOperationException("Stored Sale financial snapshot is invalid.");
            }

            return null;
        }

        return SqliteSaleFinancialSnapshotReader.Read(entity, out _);
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
            SaleFinancialReversal? financialReversal = null;
            if (sourceType == StockOperationType.Sale)
            {
                if (!SaleFinancialReversalSerializer.TryDeserialize(
                        entity.SaleCommitDataType,
                        entity.SaleCommitDataPayload,
                        out financialReversal)
                    || financialReversal.SourceOperationId != entity.SourceOperationId)
                {
                    throw new InvalidOperationException("Stored Sale financial reversal data is invalid.");
                }
            }
            else if (entity.SaleCommitDataType is not null || entity.SaleCommitDataPayload is not null)
            {
                throw new InvalidOperationException("Stored CounterMovement financial data is invalid.");
            }

            return StockOperation.CreateCounterMovement(
                entity.Id,
                entity.SourceOperationId,
                sourceType,
                entity.Justification,
                counterLines,
                timestampUtc,
                financialReversal);
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

}
