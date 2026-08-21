namespace TokenWarehouse.Domain;

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
