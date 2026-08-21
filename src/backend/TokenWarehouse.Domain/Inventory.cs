namespace TokenWarehouse.Domain;

public readonly record struct Quantity
{
    public Quantity(int value)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(value);
        Value = value;
    }

    public int Value { get; }
}

public sealed record InventoryReconciliationResult(
    int PreviousPhysicalStock,
    int CountedQuantity,
    int InventoryDifference,
    int ResultingPhysicalStock);

public static class InventoryReconciliation
{
    public static InventoryReconciliationResult Reconcile(
        int previousPhysicalStock,
        int countedQuantity)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(previousPhysicalStock);
        ArgumentOutOfRangeException.ThrowIfNegative(countedQuantity);

        var difference = (long)countedQuantity - previousPhysicalStock;
        if (difference is < int.MinValue or > int.MaxValue)
        {
            throw new OverflowException("The inventory difference does not fit in an Int32.");
        }

        return new(
            previousPhysicalStock,
            countedQuantity,
            (int)difference,
            countedQuantity);
    }

    public static InventoryReconciliationResult Reconcile(
        Quantity previousPhysicalStock,
        Quantity countedQuantity)
        => Reconcile(previousPhysicalStock.Value, countedQuantity.Value);
}

public enum StockOperationType
{
    Inventory
}

public sealed record StockOperationLine
{
    private StockOperationLine(
        int lineNumber,
        Ean13 ean13,
        int previousPhysicalStock,
        int countedQuantity,
        int inventoryDifference,
        int resultingPhysicalStock)
    {
        LineNumber = lineNumber;
        Ean13 = ean13;
        PreviousPhysicalStock = previousPhysicalStock;
        CountedQuantity = countedQuantity;
        InventoryDifference = inventoryDifference;
        ResultingPhysicalStock = resultingPhysicalStock;
    }

    public int LineNumber { get; }

    public Ean13 Ean13 { get; }

    public int PreviousPhysicalStock { get; }

    public int CountedQuantity { get; }

    public int InventoryDifference { get; }

    public int ResultingPhysicalStock { get; }

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
            reconciliation.ResultingPhysicalStock);
    }
}

public sealed record StockOperation
{
    private StockOperation(
        string id,
        StockOperationType type,
        IReadOnlyList<StockOperationLine> lines,
        DateTimeOffset timestampUtc)
    {
        Id = id;
        Type = type;
        Lines = Array.AsReadOnly(lines.ToArray());
        TimestampUtc = timestampUtc.ToUniversalTime();
    }

    public string Id { get; }

    public StockOperationType Type { get; }

    public IReadOnlyList<StockOperationLine> Lines { get; }

    public Ean13 Ean13 => Lines[0].Ean13;

    public int PreviousPhysicalStock => Lines[0].PreviousPhysicalStock;

    public int CountedQuantity => Lines[0].CountedQuantity;

    public int InventoryDifference => Lines[0].InventoryDifference;

    public int ResultingPhysicalStock => Lines[0].ResultingPhysicalStock;

    public DateTimeOffset TimestampUtc { get; }

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

        return new(id, StockOperationType.Inventory, lines, timestampUtc);
    }
}
