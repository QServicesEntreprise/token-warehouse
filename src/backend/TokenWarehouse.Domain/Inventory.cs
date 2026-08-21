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
