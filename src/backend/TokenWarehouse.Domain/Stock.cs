namespace TokenWarehouse.Domain;

public sealed record StockPosition
{
    public StockPosition(Ean13 ean13, int physicalQuantity, int version = 0)
    {
        if (physicalQuantity < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(physicalQuantity));
        }

        if (version < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(version));
        }

        Ean13 = ean13;
        PhysicalQuantity = physicalQuantity;
        Version = version;
    }

    public Ean13 Ean13 { get; }

    public int PhysicalQuantity { get; }

    public int Version { get; }

    public StockPosition Add(Quantity quantity)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(quantity.Value);
        return new(Ean13, checked(PhysicalQuantity + quantity.Value), Version);
    }
}

public readonly record struct Quantity
{
    public Quantity(int value)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(value);
        Value = value;
    }

    public int Value { get; }

    public static bool TryCreatePositive(int? value, out Quantity quantity)
    {
        if (value is not > 0)
        {
            quantity = default;
            return false;
        }

        quantity = new Quantity(value.Value);
        return true;
    }
}

public enum StockOperationType
{
    Supply,
    Inventory,
    Sale,
    CounterMovement
}

public sealed record StockOperationLine
{
    public StockOperationLine(int lineNumber, Ean13 ean13, Quantity quantity)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(lineNumber);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(quantity.Value);
        LineNumber = lineNumber;
        Ean13 = ean13;
        Quantity = quantity;
        PreviousPhysicalStock = 0;
        CountedQuantity = 0;
        InventoryDifference = 0;
        ResultingPhysicalStock = 0;
        StockEffect = quantity.Value;
        InverseEffect = 0;
    }

    private StockOperationLine(
        int lineNumber,
        Ean13 ean13,
        int previousPhysicalStock,
        int countedQuantity,
        int inventoryDifference,
        int resultingPhysicalStock,
        int stockEffect,
        int inverseEffect)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(lineNumber, 1);
        LineNumber = lineNumber;
        Ean13 = ean13;
        Quantity = new(0);
        PreviousPhysicalStock = previousPhysicalStock;
        CountedQuantity = countedQuantity;
        InventoryDifference = inventoryDifference;
        ResultingPhysicalStock = resultingPhysicalStock;
        StockEffect = stockEffect;
        InverseEffect = inverseEffect;
    }

    public int LineNumber { get; }

    public Ean13 Ean13 { get; }

    public Quantity Quantity { get; }

    public int PreviousPhysicalStock { get; }

    public int CountedQuantity { get; }

    public int InventoryDifference { get; }

    public int ResultingPhysicalStock { get; }

    public int StockEffect { get; }

    public int InverseEffect { get; }

    public static StockOperationLine CreateInventoryLine(
        int lineNumber,
        Ean13 ean13,
        InventoryReconciliationResult reconciliation)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(lineNumber, 1);
        ArgumentNullException.ThrowIfNull(reconciliation);
        if (InventoryReconciliation.Reconcile(
                reconciliation.PreviousPhysicalStock,
                reconciliation.CountedQuantity) != reconciliation)
        {
            throw new ArgumentException("The reconciliation result is inconsistent.", nameof(reconciliation));
        }

        return new(
            lineNumber,
            ean13,
            reconciliation.PreviousPhysicalStock,
            reconciliation.CountedQuantity,
            reconciliation.InventoryDifference,
            reconciliation.ResultingPhysicalStock,
            reconciliation.InventoryDifference,
            0);
    }

    public static StockOperationLine CreateSaleLine(int lineNumber, Ean13 ean13, Quantity quantity)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(lineNumber, 1);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(quantity.Value);
        return new(lineNumber, ean13, 0, 0, 0, 0, -quantity.Value, 0);
    }

    public static StockOperationLine CreateCounterMovementLine(
        int lineNumber,
        Ean13 ean13,
        int sourceEffect)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(lineNumber, 1);
        if (sourceEffect == int.MinValue)
        {
            throw new OverflowException("The counter-movement effect does not fit in an Int32.");
        }

        return new(lineNumber, ean13, 0, 0, 0, 0, sourceEffect, -sourceEffect);
    }
}

public sealed record StockOperation
{
    public StockOperation(
        string id,
        StockOperationType type,
        Ean13 ean13,
        Quantity quantity,
        DateTimeOffset occurredAt)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            throw new ArgumentException("An operation identifier is required.", nameof(id));
        }

        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(quantity.Value);
        if (type is not (StockOperationType.Supply or StockOperationType.Sale))
        {
            throw new ArgumentOutOfRangeException(
                nameof(type),
                type,
                "Only supply and sale operations use this constructor.");
        }

        Id = id;
        Type = type;
        Ean13 = ean13;
        Quantity = quantity;
        OccurredAt = occurredAt.ToUniversalTime();
        TimestampUtc = OccurredAt;
        Lines = type switch
        {
            StockOperationType.Supply => [new StockOperationLine(1, ean13, quantity)],
            StockOperationType.Sale => [StockOperationLine.CreateSaleLine(1, ean13, quantity)],
            _ => []
        };
        SourceOperationId = null;
        SourceOperationType = null;
        Justification = null;
    }

    private StockOperation(
        string id,
        IReadOnlyList<StockOperationLine> lines,
        DateTimeOffset timestampUtc)
    {
        Id = id;
        Type = StockOperationType.Inventory;
        Ean13 = lines[0].Ean13;
        Quantity = new(0);
        OccurredAt = timestampUtc.ToUniversalTime();
        PreviousPhysicalStock = lines[0].PreviousPhysicalStock;
        CountedQuantity = lines[0].CountedQuantity;
        InventoryDifference = lines[0].InventoryDifference;
        ResultingPhysicalStock = lines[0].ResultingPhysicalStock;
        TimestampUtc = OccurredAt;
        Lines = Array.AsReadOnly(lines.ToArray());
        SourceOperationId = null;
        SourceOperationType = null;
        Justification = null;
    }

    private StockOperation(
        string id,
        Ean13 ean13,
        Quantity quantity,
        DateTimeOffset occurredAt,
        IReadOnlyList<StockOperationLine> lines)
        : this(id, StockOperationType.Supply, ean13, quantity, occurredAt)
    {
        Lines = CopyLines(lines);
        SourceOperationId = null;
        SourceOperationType = null;
        Justification = null;
    }

    private StockOperation(
        string id,
        string sourceOperationId,
        StockOperationType sourceOperationType,
        string justification,
        IReadOnlyList<StockOperationLine> lines,
        DateTimeOffset timestampUtc)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            throw new ArgumentException("An operation identifier is required.", nameof(id));
        }

        if (string.IsNullOrWhiteSpace(sourceOperationId))
        {
            throw new ArgumentException("A source operation identifier is required.", nameof(sourceOperationId));
        }

        if (string.IsNullOrWhiteSpace(justification))
        {
            throw new ArgumentException("A justification is required.", nameof(justification));
        }

        ArgumentNullException.ThrowIfNull(lines);
        if (lines.Count == 0)
        {
            throw new ArgumentException("A counter-movement must contain at least one line.", nameof(lines));
        }

        Id = id;
        Type = StockOperationType.CounterMovement;
        Ean13 = lines[0].Ean13;
        Quantity = new(0);
        OccurredAt = timestampUtc.ToUniversalTime();
        TimestampUtc = OccurredAt;
        Lines = Array.AsReadOnly(lines.ToArray());
        SourceOperationId = sourceOperationId;
        SourceOperationType = sourceOperationType;
        Justification = justification.Trim();
    }

    public string Id { get; }

    public StockOperationType Type { get; }

    public Ean13 Ean13 { get; }

    public Quantity Quantity { get; }

    public DateTimeOffset OccurredAt { get; }

    public int PreviousPhysicalStock { get; }

    public int CountedQuantity { get; }

    public int InventoryDifference { get; }

    public int ResultingPhysicalStock { get; }

    public DateTimeOffset TimestampUtc { get; }

    public IReadOnlyList<StockOperationLine> Lines { get; }

    public string? SourceOperationId { get; }

    public StockOperationType? SourceOperationType { get; }

    public string? Justification { get; }

    public static StockOperation CreateSupply(
        string id,
        Ean13 ean13,
        Quantity quantity,
        DateTimeOffset occurredAt)
        => new(id, StockOperationType.Supply, ean13, quantity, occurredAt);

    public static StockOperation CreateSale(
        string id,
        Ean13 ean13,
        Quantity quantity,
        DateTimeOffset occurredAt)
        => new(id, StockOperationType.Sale, ean13, quantity, occurredAt);

    public static StockOperation CreateBulkSupply(
        string id,
        IReadOnlyList<StockOperationLine> lines,
        DateTimeOffset occurredAt)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(id);
        ArgumentNullException.ThrowIfNull(lines);
        if (lines.Count == 0)
        {
            throw new ArgumentException("A bulk supply must contain at least one line.", nameof(lines));
        }

        var copied = lines.ToArray();
        var eans = new HashSet<Ean13>();
        var totalQuantity = 0;
        for (var index = 0; index < copied.Length; index++)
        {
            var line = copied[index]
                ?? throw new ArgumentException("A bulk supply line is required.", nameof(lines));
            if (line.LineNumber != index + 1)
            {
                throw new ArgumentException("Bulk supply line numbers must be consecutive.", nameof(lines));
            }

            if (!eans.Add(line.Ean13))
            {
                throw new ArgumentException("A bulk supply cannot contain duplicate Articles.", nameof(lines));
            }

            totalQuantity = checked(totalQuantity + line.Quantity.Value);
        }

        return new(
            id,
            copied[0].Ean13,
            new Quantity(totalQuantity),
            occurredAt,
            copied);
    }

    public static StockOperation CreateInventory(
        string id,
        Ean13 ean13,
        InventoryReconciliationResult reconciliation,
        DateTimeOffset timestampUtc)
    {
        return CreateInventory(
            id,
            [StockOperationLine.CreateInventoryLine(1, ean13, reconciliation)],
            timestampUtc);
    }

    public static StockOperation CreateInventory(
        string id,
        IReadOnlyList<StockOperationLine> lines,
        DateTimeOffset timestampUtc)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(id);
        ArgumentNullException.ThrowIfNull(lines);
        if (lines.Count == 0)
        {
            throw new ArgumentException("An inventory operation must contain at least one line.", nameof(lines));
        }

        for (var index = 0; index < lines.Count; index++)
        {
            ArgumentNullException.ThrowIfNull(lines[index]);
            if (lines[index].LineNumber != index + 1)
            {
                throw new ArgumentException("Inventory line numbers must be consecutive and ordered.", nameof(lines));
            }
        }

        if (lines.Select(line => line.Ean13).Distinct().Count() != lines.Count)
        {
            throw new ArgumentException("An inventory operation cannot contain duplicate Articles.", nameof(lines));
        }

        return new(id, lines, timestampUtc);
    }

    public static StockOperation CreateCounterMovement(
        string id,
        string sourceOperationId,
        StockOperationType sourceOperationType,
        string justification,
        IReadOnlyList<CounterMovementLinePlan> lines,
        DateTimeOffset timestampUtc)
    {
        ArgumentNullException.ThrowIfNull(lines);
        if (lines.Count == 0)
        {
            throw new ArgumentException("A counter-movement must contain at least one line.", nameof(lines));
        }

        if (sourceOperationType is not (StockOperationType.Supply
            or StockOperationType.Inventory
            or StockOperationType.Sale))
        {
            throw new CounterMovementUnsupportedSourceException(sourceOperationType);
        }

        if (!global::TokenWarehouse.Domain.Justification.TryCreate(justification, out var normalizedJustification))
        {
            throw new ArgumentException("A justification is required.", nameof(justification));
        }

        var eans = new HashSet<Ean13>();
        var operationLines = lines
            .Select((line, index) =>
            {
                ArgumentNullException.ThrowIfNull(line);
                if (!eans.Add(line.Ean13))
                {
                    throw new ArgumentException("A counter-movement cannot contain duplicate Articles.", nameof(lines));
                }

                if (line.SourceEffect == int.MinValue
                    || line.InverseEffect != -line.SourceEffect)
                {
                    throw new ArgumentException("A counter-movement line must negate its source effect.", nameof(lines));
                }

                return StockOperationLine.CreateCounterMovementLine(
                    index + 1,
                    line.Ean13,
                    line.SourceEffect);
            })
            .ToArray();
        return new(
            id,
            sourceOperationId,
            sourceOperationType,
            normalizedJustification.Value,
            operationLines,
            timestampUtc);
    }

    private static IReadOnlyList<StockOperationLine> CopyLines(
        IReadOnlyList<StockOperationLine> lines)
        => Array.AsReadOnly(lines.ToArray());
}

public enum StockAvailability
{
    Available,
    OutOfStock,
    NotSellable
}

public enum SellabilityReason
{
    Archived,
    DlcExpired,
    UnsellablePackaging
}

public sealed record ArticleSellabilitySnapshot(
    Ean13 Ean13,
    string Name,
    ArticleType Type,
    bool IsActive,
    DateOnly? Dlc,
    IReadOnlyList<ConsumptionMode> ConsumptionModes,
    PackagingCondition? Packaging,
    int Version = 0)
{
    public static ArticleSellabilitySnapshot From(Article article)
    {
        ArgumentNullException.ThrowIfNull(article);

        return new(
            article.Ean13,
            article.Name,
            article.Type,
            article.IsActive,
            article.Dlc,
            article.ConsumptionModes,
            article.Packaging,
            article.Version);
    }
}

public sealed record SellabilityDecision(
    int SellableQuantity,
    StockAvailability Availability,
    SellabilityReason? Reason);

public static class SellabilityPolicy
{
    public static int Calculate(Article article, StockPosition? position, DateOnly warehouseDate)
        => Calculate(article, position?.PhysicalQuantity ?? 0, warehouseDate);

    public static int Calculate(Article article, int physicalQuantity, DateOnly warehouseDate)
        => Decide(article, physicalQuantity, warehouseDate).SellableQuantity;

    public static SellabilityDecision Decide(Article article, int physicalQuantity, DateOnly warehouseDate)
    {
        ArgumentNullException.ThrowIfNull(article);
        return Decide(ArticleSellabilitySnapshot.From(article), physicalQuantity, warehouseDate);
    }

    public static SellabilityDecision Decide(
        ArticleSellabilitySnapshot article,
        int physicalQuantity,
        DateOnly warehouseDate)
    {
        ArgumentNullException.ThrowIfNull(article);
        ArgumentOutOfRangeException.ThrowIfNegative(physicalQuantity);

        if (physicalQuantity == 0)
        {
            return new(0, StockAvailability.OutOfStock, null);
        }

        if (!article.IsActive)
        {
            return new(0, StockAvailability.NotSellable, SellabilityReason.Archived);
        }

        if (article.Type == ArticleType.Food && article.Dlc is { } dlc && warehouseDate > dlc)
        {
            return new(0, StockAvailability.NotSellable, SellabilityReason.DlcExpired);
        }

        if (article.Type == ArticleType.NonFood && article.Packaging == PackagingCondition.Unsellable)
        {
            return new(0, StockAvailability.NotSellable, SellabilityReason.UnsellablePackaging);
        }

        return new(physicalQuantity, StockAvailability.Available, null);
    }
}
