namespace TokenWarehouse.Domain;

public sealed record SaleFinancialReversal(
    string SourceOperationId,
    Money UnitPriceHt,
    SaleContext? SaleContext,
    TaxRate TaxRate,
    Money AmountHt,
    Money Vat,
    Money AmountTtc);

public static class SaleFinancialReversalPolicy
{
    public static SaleFinancialReversal Create(
        string sourceOperationId,
        SaleFinancialSnapshot snapshot)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sourceOperationId);
        ArgumentNullException.ThrowIfNull(snapshot);
        if (snapshot.UnitPriceHt.Cents < 0
            || snapshot.AmountHt.Cents < 0
            || snapshot.Vat.Cents < 0
            || snapshot.AmountTtc.Cents < 0
            || (long)snapshot.AmountTtc.Cents != (long)snapshot.AmountHt.Cents + snapshot.Vat.Cents)
        {
            throw new ArgumentException("The Sale financial snapshot is inconsistent.", nameof(snapshot));
        }

        return new(
            sourceOperationId,
            snapshot.UnitPriceHt,
            snapshot.SaleContext,
            snapshot.TaxRate,
            Money.FromCents(checked(-snapshot.AmountHt.Cents)),
            Money.FromCents(checked(-snapshot.Vat.Cents)),
            Money.FromCents(checked(-snapshot.AmountTtc.Cents)));
    }
}
