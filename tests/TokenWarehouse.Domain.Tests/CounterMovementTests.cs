using TokenWarehouse.Domain;
using Xunit;

namespace TokenWarehouse.Domain.Tests;

public sealed class CounterMovementTests
{
    [Theory]
    [InlineData("supply", 8, 10, -8, 2)]
    [InlineData("sale", -3, 7, 3, 10)]
    [InlineData("inventory", 4, 13, -4, 9)]
    [InlineData("inventory", -4, 9, 4, 13)]
    [InlineData("inventory", 0, 10, 0, 10)]
    public void Policy_negates_the_immutable_source_effect_on_the_current_position(
        string sourceType,
        int sourceEffect,
        int currentPhysicalStock,
        int expectedInverseEffect,
        int expectedResultingPhysicalStock)
    {
        var ean13 = ParseEan("0123456789012");
        var source = sourceType switch
        {
            "supply" => StockOperation.CreateSupply(
                "source-1",
                ean13,
                new Quantity(sourceEffect),
                Timestamp),
            "sale" => StockOperation.CreateSale(
                "source-1",
                ean13,
                new Quantity(-sourceEffect),
                Timestamp),
            _ => StockOperation.CreateInventory(
                "source-1",
                ean13,
                InventoryReconciliation.Reconcile(8, 8 + sourceEffect),
                Timestamp)
        };

        var plan = CounterMovementPolicy.CreatePlan(
            source,
            [new StockPosition(ean13, currentPhysicalStock)]);

        Assert.Equal(sourceEffect, plan.Lines[0].SourceEffect);
        Assert.Equal(expectedInverseEffect, plan.Lines[0].InverseEffect);
        Assert.Equal(expectedResultingPhysicalStock, plan.Lines[0].ResultingPhysicalStock);
    }

    [Fact]
    public void Policy_rejects_a_negative_result_without_saturating_to_zero()
    {
        var ean13 = ParseEan("0123456789012");
        var source = StockOperation.CreateSupply("source-2", ean13, new Quantity(8), Timestamp);

        Assert.Throws<CounterMovementNegativeStockException>(() => CounterMovementPolicy.CreatePlan(
            source,
            [new StockPosition(ean13, 5)]));
    }

    private static readonly DateTimeOffset Timestamp =
        new(2030, 1, 15, 9, 0, 0, TimeSpan.Zero);

    private static Ean13 ParseEan(string value)
    {
        Assert.True(Ean13.TryCreate(value, out var ean13));
        return ean13;
    }
}
