using TokenWarehouse.Domain;
using Xunit;

namespace TokenWarehouse.Domain.Tests;

public sealed class InventoryTests
{
    [Theory]
    [InlineData(8, 11, 3)]
    [InlineData(8, 5, -3)]
    [InlineData(8, 8, 0)]
    [InlineData(8, 0, -8)]
    public void Reconciliation_establishes_the_counted_quantity_and_keeps_the_difference(
        int previousPhysicalStock,
        int countedQuantity,
        int expectedDifference)
    {
        var result = InventoryReconciliation.Reconcile(previousPhysicalStock, countedQuantity);

        Assert.Equal(previousPhysicalStock, result.PreviousPhysicalStock);
        Assert.Equal(countedQuantity, result.CountedQuantity);
        Assert.Equal(expectedDifference, result.InventoryDifference);
        Assert.Equal(countedQuantity, result.ResultingPhysicalStock);
    }

    [Fact]
    public void Reconciliation_rejects_negative_quantities()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => InventoryReconciliation.Reconcile(-1, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => InventoryReconciliation.Reconcile(0, -1));
    }

    [Fact]
    public void Inventory_operation_keeps_a_zero_difference_as_an_immutable_fact()
    {
        Assert.True(Ean13.TryCreate("0123456789012", out var ean13));
        var operation = StockOperation.CreateInventory(
            "operation-1",
            ean13,
            InventoryReconciliation.Reconcile(8, 8),
            new DateTimeOffset(2030, 1, 15, 10, 0, 0, TimeSpan.Zero));

        Assert.Equal("operation-1", operation.Id);
        Assert.Equal(StockOperationType.Inventory, operation.Type);
        Assert.Equal(0, operation.InventoryDifference);
        Assert.Equal(8, operation.ResultingPhysicalStock);
        Assert.Equal(new DateTimeOffset(2030, 1, 15, 10, 0, 0, TimeSpan.Zero), operation.TimestampUtc);
    }
}
