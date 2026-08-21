using TokenWarehouse.Domain;
using Xunit;

namespace TokenWarehouse.Domain.Tests;

public sealed class SupplyTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Supply_quantity_must_be_strictly_positive(int value)
    {
        Assert.False(Quantity.TryCreatePositive(value, out _));
    }

    [Fact]
    public void Stock_position_adds_a_positive_supply_without_mutating_the_source()
    {
        Assert.True(Ean13.TryCreate("0123456789012", out var ean13));
        Assert.True(Quantity.TryCreatePositive(3, out var quantity));
        var source = new StockPosition(ean13, 8);

        var result = source.Add(quantity);

        Assert.Equal(8, source.PhysicalQuantity);
        Assert.Equal(11, result.PhysicalQuantity);
        Assert.Equal(ean13, result.Ean13);
    }

    [Fact]
    public void Supply_operation_is_an_immutable_server_fact()
    {
        Assert.True(Ean13.TryCreate("0123456789012", out var ean13));
        Assert.True(Quantity.TryCreatePositive(3, out var quantity));
        var occurredAt = new DateTimeOffset(2030, 1, 15, 10, 0, 0, TimeSpan.Zero);

        var operation = StockOperation.CreateSupply("server-operation-1", ean13, quantity, occurredAt);

        Assert.Equal("server-operation-1", operation.Id);
        Assert.Equal(StockOperationType.Supply, operation.Type);
        Assert.Equal(ean13, operation.Ean13);
        Assert.Equal(3, operation.Quantity.Value);
        Assert.Equal(occurredAt, operation.OccurredAt);
    }
}
