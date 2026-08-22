using TokenWarehouse.Domain;
using Xunit;

namespace TokenWarehouse.Domain.Tests;

public sealed class SaleFinancialReversalTests
{
    [Theory]
    [InlineData("takeaway", 11, 200, 1000, 55, 1055)]
    [InlineData("onsite", 1, 10, 1000, 100, 1100)]
    [InlineData("nonFood", 1, 5, 1000, 200, 1200)]
    public void Reversal_negates_every_historical_amount_and_keeps_context_and_rate(
        string context,
        int taxNumerator,
        int taxDenominator,
        int amountHt,
        int vat,
        int amountTtc)
    {
        var snapshot = new SaleFinancialSnapshot(
            context switch
            {
                "takeaway" => SaleContext.Takeaway,
                "onsite" => SaleContext.OnSite,
                _ => null
            },
            Money.FromCents(1000),
            new TaxRate(context, taxNumerator, taxDenominator),
            Money.FromCents(amountHt),
            Money.FromCents(vat),
            Money.FromCents(amountTtc));

        var reversal = SaleFinancialReversalPolicy.Create("sale-1", snapshot);

        Assert.Equal("sale-1", reversal.SourceOperationId);
        Assert.Equal(snapshot.SaleContext, reversal.SaleContext);
        Assert.Equal(snapshot.TaxRate, reversal.TaxRate);
        Assert.Equal(-amountHt, reversal.AmountHt.Cents);
        Assert.Equal(-vat, reversal.Vat.Cents);
        Assert.Equal(-amountTtc, reversal.AmountTtc.Cents);
        Assert.Equal(reversal.AmountHt.Cents + reversal.Vat.Cents, reversal.AmountTtc.Cents);
    }

    [Fact]
    public void Reversal_keeps_a_zero_financial_fact_observable()
    {
        var snapshot = new SaleFinancialSnapshot(
            null,
            Money.FromCents(0),
            TaxRate.NonFood,
            Money.FromCents(0),
            Money.FromCents(0),
            Money.FromCents(0));

        var reversal = SaleFinancialReversalPolicy.Create("sale-zero", snapshot);

        Assert.Equal(0, reversal.AmountHt.Cents);
        Assert.Equal(0, reversal.Vat.Cents);
        Assert.Equal(0, reversal.AmountTtc.Cents);
    }

    [Fact]
    public void Counter_movement_carries_the_immutable_sale_reversal()
    {
        var ean13 = ParseEan("0123456789012");
        var source = StockOperation.CreateSale("sale-2", ean13, new Quantity(3), Timestamp);
        var reversal = SaleFinancialReversalPolicy.Create(
            source.Id,
            new SaleFinancialSnapshot(
                SaleContext.Takeaway,
                Money.FromCents(1000),
                TaxRate.Takeaway,
                Money.FromCents(1000),
                Money.FromCents(55),
                Money.FromCents(1055)));
        var plan = CounterMovementPolicy.CreatePlan(source, [new StockPosition(ean13, 7)]);

        var counterMovement = StockOperation.CreateCounterMovement(
            "counter-2",
            source.Id,
            source.Type,
            "Correction financière",
            plan.Lines,
            Timestamp,
            reversal);

        Assert.Equal(reversal, counterMovement.FinancialReversal);
    }

    private static readonly DateTimeOffset Timestamp =
        new(2030, 1, 15, 10, 0, 0, TimeSpan.Zero);

    private static Ean13 ParseEan(string value)
    {
        Assert.True(Ean13.TryCreate(value, out var ean13));
        return ean13;
    }
}
