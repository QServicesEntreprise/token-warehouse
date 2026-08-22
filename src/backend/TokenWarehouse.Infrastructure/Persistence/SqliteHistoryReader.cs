using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteHistoryReader(
    IDbContextFactory<WarehouseDbContext> contextFactory) : IHistoryReader
{
    public async ValueTask<HistoryReadResult> ReadAsync(
        HistoryQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        if (query.Ean13 is { } filteredEan13
            && !await context.Articles.AsNoTracking().AnyAsync(
                article => article.Ean13 == filteredEan13.Value,
                cancellationToken))
        {
            return new(HistoryReadStatus.ArticleNotFound, [], []);
        }

        // ponytail: fuse and sort the local MVP read in memory; add a projection or pagination only after volume proves it necessary.
        var operations = await context.StockOperations
            .AsNoTracking()
            .Include(operation => operation.Lines)
            .ToListAsync(cancellationToken);
        var lifecycleFacts = await context.ArticleLifecycleHistory
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        var correctionsBySource = operations
            .Where(operation => string.Equals(operation.Type, "COUNTER_MOVEMENT", StringComparison.Ordinal)
                && !string.IsNullOrWhiteSpace(operation.SourceOperationId))
            .ToDictionary(operation => operation.SourceOperationId!, StringComparer.Ordinal);
        var operationsById = operations.ToDictionary(operation => operation.Id, StringComparer.Ordinal);

        var entries = operations
            .Select(operation => ToOperationEntry(
                operation,
                query.Ean13,
                correctionsBySource,
                operationsById))
            .Where(entry => entry is not null)
            .Cast<HistoryEntryView>()
            .Concat(lifecycleFacts
                .Select(history => ToCatalogueEntry(history, query.Ean13))
                .Where(entry => entry is not null)
                .Cast<HistoryEntryView>())
            .OrderByDescending(entry => entry.TimestampUtc)
            .ThenByDescending(entry => entry.Id, StringComparer.Ordinal)
            .ToArray();

        await transaction.CommitAsync(cancellationToken);
        return new(HistoryReadStatus.Success, entries, []);
    }

    private static HistoryEntryView? ToOperationEntry(
        StockOperationEntity entity,
        Ean13? filteredEan13,
        IReadOnlyDictionary<string, StockOperationEntity> correctionsBySource,
        IReadOnlyDictionary<string, StockOperationEntity> operationsById)
    {
        if (!TryParseTimestamp(entity.TimestampUtc, out var timestampUtc)
            || !Ean13.TryCreate(entity.Ean13, out var operationEan13))
        {
            throw new InvalidOperationException("Stored StockOperation data is invalid.");
        }

        var type = ParseOperationType(entity.Type);
        var storedLines = entity.Lines
            .OrderBy(line => line.LineNumber)
            .ToArray();
        var lines = storedLines.Length == 0
            ? [SyntheticLine(entity, operationEan13, type)]
            : storedLines.Select(line => ToHistoryLine(line, type)).ToArray();
        var selectedLines = filteredEan13 is null
            ? lines
            : lines.Where(line => line.Ean13 == filteredEan13.Value).ToArray();
        if (selectedLines.Length == 0)
        {
            return null;
        }

        var sourceOperationId = type == HistoryEntryType.CounterMovement
            ? entity.SourceOperationId
            : null;
        var sourceOperationType = type == HistoryEntryType.CounterMovement
            ? ToWireOperationType(entity.SourceOperationType)
            : null;
        SaleFinancialReversal? financialReversal = null;
        if (type == HistoryEntryType.CounterMovement
            && string.Equals(entity.SourceOperationType, "SALE", StringComparison.OrdinalIgnoreCase))
        {
            if (entity.SourceOperationId is null
                || !operationsById.TryGetValue(entity.SourceOperationId, out var sourceSale))
            {
                throw new InvalidOperationException("Stored Sale financial reversal data is invalid.");
            }

            financialReversal = SqliteSaleFinancialSnapshotReader.ReadReversal(
                entity,
                entity.Lines.OrderBy(line => line.LineNumber).ToArray(),
                sourceSale);
        }
        SaleFinancialSnapshot? financial = null;
        if (type == HistoryEntryType.SaleStock)
        {
            financial = SqliteSaleFinancialSnapshotReader.Read(entity, out _);
        }
        var firstLine = selectedLines[0];
        var rootLine = storedLines.Length > 1 ? null : firstLine;
        var isSource = correctionsBySource.TryGetValue(entity.Id, out var correction);

        return new HistoryEntryView
        {
            Id = entity.Id,
            Type = type,
            TimestampUtc = timestampUtc,
            Articles = selectedLines
                .Select(line => new HistoryArticleView(line.Ean13))
                .DistinctBy(article => article.Ean13)
                .ToArray(),
            Quantity = type is HistoryEntryType.Supply or HistoryEntryType.SaleStock
                ? rootLine?.Quantity
                : type == HistoryEntryType.CounterMovement
                    && rootLine is { InverseEffect: > 0 }
                    ? rootLine.InverseEffect
                : null,
            StockEffect = type is HistoryEntryType.Supply or HistoryEntryType.SaleStock or HistoryEntryType.Inventory
                ? rootLine?.StockEffect
                : null,
            PreviousPhysicalStock = type == HistoryEntryType.CounterMovement
                ? null
                : rootLine?.PreviousPhysicalStock,
            CountedQuantity = type == HistoryEntryType.Inventory
                ? rootLine?.CountedQuantity
                : null,
            Difference = type == HistoryEntryType.Inventory
                ? rootLine?.Difference
                : null,
            ResultingPhysicalStock = type is HistoryEntryType.Inventory
                or HistoryEntryType.Supply
                or HistoryEntryType.SaleStock
                ? rootLine?.ResultingPhysicalStock
                : null,
            Lines = selectedLines,
            SourceOperationId = sourceOperationId,
            SourceOperationType = sourceOperationType,
            Justification = type == HistoryEntryType.CounterMovement ? entity.Justification : null,
            Financial = financial,
            FinancialReversal = financialReversal,
            CorrectedByOperationId = isSource ? correction!.Id : null,
            CorrectionOperationId = type == HistoryEntryType.CounterMovement ? entity.Id : null,
            Ean13 = firstLine.Ean13.Value,
            OccurredAt = timestampUtc,
            Kind = "stock"
        };
    }

    private static HistoryEntryView? ToCatalogueEntry(
        ArticleLifecycleHistoryEntity entity,
        Ean13? filteredEan13)
    {
        if (string.IsNullOrWhiteSpace(entity.FactId)
            || !Ean13.TryCreate(entity.Ean13, out var ean13)
            || !TryParseTimestamp(entity.OccurredAt, out var timestampUtc))
        {
            throw new InvalidOperationException("Stored Article history data is invalid.");
        }

        if (filteredEan13 is not null && filteredEan13.Value != ean13)
        {
            return null;
        }

        if (string.Equals(entity.Kind, "lifecycle", StringComparison.Ordinal))
        {
            if (!TryParseStatus(entity.PreviousStatus, out var previousStatus)
                || !TryParseStatus(entity.NextStatus, out var nextStatus))
            {
                throw new InvalidOperationException("Stored Article lifecycle history data is invalid.");
            }

            return new HistoryEntryView
            {
                Id = entity.FactId,
                Type = nextStatus == ArticleLifecycleStatus.Archived
                    ? HistoryEntryType.CatalogArchive
                    : HistoryEntryType.CatalogReactivate,
                TimestampUtc = timestampUtc,
                Articles = [new HistoryArticleView(ean13)],
                PreviousStatus = previousStatus,
                NextStatus = nextStatus,
                Ean13 = ean13.Value,
                OccurredAt = timestampUtc,
                Kind = "lifecycle"
            };
        }

        if (!string.Equals(entity.Kind, "attributes", StringComparison.Ordinal)
            || string.IsNullOrWhiteSpace(entity.ChangesJson))
        {
            throw new InvalidOperationException("Stored Article attribute history data is invalid.");
        }

        var changes = JsonSerializer.Deserialize<IReadOnlyList<HistoryChangeView>>(entity.ChangesJson);
        if (changes is null || changes.Count == 0)
        {
            throw new InvalidOperationException("Stored Article attribute history data is invalid.");
        }

        var type = changes.Any(change => string.Equals(change.Field, "dlc", StringComparison.OrdinalIgnoreCase))
            ? HistoryEntryType.CatalogDlcChange
            : changes.Any(change => string.Equals(change.Field, "packaging", StringComparison.OrdinalIgnoreCase))
                ? HistoryEntryType.CatalogPackagingChange
                : HistoryEntryType.CatalogAttributeChange;
        return new HistoryEntryView
        {
            Id = entity.FactId,
            Type = type,
            TimestampUtc = timestampUtc,
            Articles = [new HistoryArticleView(ean13)],
            Changes = changes,
            Ean13 = ean13.Value,
            OccurredAt = timestampUtc,
            Kind = "attributes"
        };
    }

    private static HistoryLineView ToHistoryLine(
        StockOperationLineEntity entity,
        HistoryEntryType type)
    {
        if (!Ean13.TryCreate(entity.Ean13, out var ean13))
        {
            throw new InvalidOperationException("Stored StockOperation line data is invalid.");
        }

        return new HistoryLineView
        {
            LineNumber = entity.LineNumber,
            Ean13 = ean13,
            Quantity = type is HistoryEntryType.Supply or HistoryEntryType.SaleStock
                ? entity.Quantity
                : null,
            PreviousPhysicalStock = type == HistoryEntryType.CounterMovement
                ? null
                : entity.PreviousPhysicalStock,
            CountedQuantity = type == HistoryEntryType.Inventory ? entity.CountedQuantity : null,
            Difference = type == HistoryEntryType.Inventory ? entity.InventoryDifference : null,
            StockEffect = type is HistoryEntryType.Supply or HistoryEntryType.SaleStock or HistoryEntryType.Inventory or HistoryEntryType.CounterMovement
                ? entity.SourceEffect
                : null,
            InverseEffect = type == HistoryEntryType.CounterMovement ? entity.InverseEffect : null,
            ResultingPhysicalStock = type is HistoryEntryType.Supply or HistoryEntryType.SaleStock or HistoryEntryType.Inventory
                ? entity.ResultingPhysicalStock
                : null
        };
    }

    private static HistoryLineView SyntheticLine(
        StockOperationEntity entity,
        Ean13 ean13,
        HistoryEntryType type)
        => new()
        {
            LineNumber = 1,
            Ean13 = ean13,
            Quantity = type is HistoryEntryType.Supply or HistoryEntryType.SaleStock ? entity.Quantity : null,
            PreviousPhysicalStock = type == HistoryEntryType.CounterMovement
                ? null
                : entity.PreviousPhysicalStock,
            CountedQuantity = type == HistoryEntryType.Inventory ? entity.CountedQuantity : null,
            Difference = type == HistoryEntryType.Inventory ? entity.InventoryDifference : null,
            StockEffect = type switch
            {
                HistoryEntryType.Supply => entity.Quantity,
                HistoryEntryType.SaleStock => -entity.Quantity,
                HistoryEntryType.Inventory => entity.InventoryDifference,
                _ => null
            },
            ResultingPhysicalStock = type is HistoryEntryType.Supply or HistoryEntryType.SaleStock or HistoryEntryType.Inventory
                ? entity.ResultingPhysicalStock
                : null
        };

    private static HistoryEntryType ParseOperationType(string type)
        => type.ToUpperInvariant() switch
        {
            "SUPPLY" => HistoryEntryType.Supply,
            "INVENTORY" => HistoryEntryType.Inventory,
            "SALE" => HistoryEntryType.SaleStock,
            "COUNTER_MOVEMENT" => HistoryEntryType.CounterMovement,
            _ => throw new InvalidOperationException("Stored StockOperation type is invalid.")
        };

    private static string? ToWireOperationType(string? type)
        => type?.ToUpperInvariant() switch
        {
            "SUPPLY" => "SUPPLY",
            "INVENTORY" => "INVENTORY",
            "SALE" => "SALE_STOCK",
            _ => type
        };

    private static bool TryParseStatus(string value, out ArticleLifecycleStatus status)
        => value switch
        {
            "active" => Set(ArticleLifecycleStatus.Active, out status),
            "archived" => Set(ArticleLifecycleStatus.Archived, out status),
            _ => Set(default, out status, false)
        };

    private static bool Set(
        ArticleLifecycleStatus value,
        out ArticleLifecycleStatus status,
        bool result = true)
    {
        status = value;
        return result;
    }

    private static bool TryParseTimestamp(string value, out DateTimeOffset timestampUtc)
    {
        if (!DateTimeOffset.TryParse(
                value,
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind,
                out var parsed))
        {
            timestampUtc = default;
            return false;
        }

        timestampUtc = parsed.ToUniversalTime();
        return true;
    }
}
