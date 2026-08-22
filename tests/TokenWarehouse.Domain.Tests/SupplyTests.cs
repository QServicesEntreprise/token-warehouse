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
    public void Stock_position_applies_a_signed_sale_effect_without_mutating_the_source()
    {
        Assert.True(Ean13.TryCreate("0123456789012", out var ean13));
        var source = new StockPosition(ean13, 8, 2);

        var result = source.ApplyEffect(-3);

        Assert.Equal(8, source.PhysicalQuantity);
        Assert.Equal(2, source.Version);
        Assert.Equal(5, result.PhysicalQuantity);
        Assert.Equal(2, result.Version);
    }

    [Fact]
    public void Stock_position_rejects_a_signed_effect_that_would_make_stock_negative()
    {
        Assert.True(Ean13.TryCreate("0123456789012", out var ean13));

        Assert.Throws<InvalidOperationException>(() => new StockPosition(ean13, 2).ApplyEffect(-3));
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

    [Fact]
    public void Sale_operation_keeps_its_positive_quantity_and_signed_stock_effect()
    {
        Assert.True(Ean13.TryCreate("0123456789012", out var ean13));

        var operation = StockOperation.CreateSale(
            "server-sale-1",
            ean13,
            new Quantity(3),
            new DateTimeOffset(2030, 1, 15, 10, 0, 0, TimeSpan.Zero));

        Assert.Equal(3, operation.Quantity.Value);
        Assert.Equal(3, operation.Lines.Single().Quantity.Value);
        Assert.Equal(-3, operation.Lines.Single().StockEffect);
        Assert.False(operation.Lines is StockOperationLine[]);
    }

    [Fact]
    public void Bulk_supply_operation_keeps_distinct_lines_in_request_order()
    {
        Assert.True(Ean13.TryCreate("0123456789012", out var first));
        Assert.True(Ean13.TryCreate("5901234123457", out var second));
        var source = new List<StockOperationLine>
        {
            new(1, first, new Quantity(3)),
            new(2, second, new Quantity(2))
        };
        var operation = StockOperation.CreateBulkSupply(
            "server-operation-2",
            source,
            new DateTimeOffset(2030, 1, 15, 10, 0, 0, TimeSpan.Zero));

        source[0] = new StockOperationLine(1, second, new Quantity(99));

        Assert.Equal(StockOperationType.Supply, operation.Type);
        Assert.Equal(2, operation.Lines.Count);
        Assert.Equal(1, operation.Lines[0].LineNumber);
        Assert.Equal(first, operation.Lines[0].Ean13);
        Assert.Equal(3, operation.Lines[0].Quantity.Value);
        Assert.Equal(2, operation.Lines[1].LineNumber);
        Assert.Equal(second, operation.Lines[1].Ean13);
        Assert.Equal(2, operation.Lines[1].Quantity.Value);
    }

    [Fact]
    public void Bulk_supply_operation_rejects_empty_or_duplicate_lines()
    {
        Assert.True(Ean13.TryCreate("0123456789012", out var ean13));

        Assert.Throws<ArgumentException>(() => StockOperation.CreateBulkSupply(
            "empty-operation",
            [],
            DateTimeOffset.UtcNow));
        Assert.Throws<ArgumentException>(() => StockOperation.CreateBulkSupply(
            "duplicate-operation",
            [
                new StockOperationLine(1, ean13, new Quantity(1)),
                new StockOperationLine(2, ean13, new Quantity(2))
            ],
            DateTimeOffset.UtcNow));
    }
}
