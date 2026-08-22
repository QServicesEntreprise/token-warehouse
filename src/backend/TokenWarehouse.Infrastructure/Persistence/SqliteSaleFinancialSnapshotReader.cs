using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Infrastructure.Persistence;

internal static class SqliteSaleFinancialSnapshotReader
{
    public static SaleFinancialSnapshot Read(
        StockOperationEntity entity,
        out StockPositionView? position)
    {
        if (!TryRead(entity, out var snapshot, out position))
        {
            throw new InvalidOperationException("Stored Sale financial snapshot is invalid.");
        }

        return snapshot;
    }

    private static bool TryRead(
        StockOperationEntity entity,
        out SaleFinancialSnapshot snapshot,
        out StockPositionView? position)
    {
        snapshot = default!;
        position = null;
        if (!SaleFinancialSnapshotSerializer.TryDeserialize(
                entity.SaleCommitDataType,
                entity.SaleCommitDataPayload,
                out snapshot,
                out position)
            || !IsCanonical(snapshot, entity.Quantity)
            || !MatchesPersistedSnapshot(entity, snapshot))
        {
            snapshot = default!;
            position = null;
            return false;
        }

        return true;
    }

    private static bool IsCanonical(SaleFinancialSnapshot snapshot, int quantity)
    {
        if (quantity <= 0
            || snapshot.UnitPriceHt.Cents < 0
            || snapshot.AmountHt.Cents < 0
            || snapshot.Vat.Cents < 0
            || snapshot.AmountTtc.Cents < 0)
        {
            return false;
        }

        var expectedTaxRate = snapshot.SaleContext switch
        {
            SaleContext.Takeaway => (TaxRate?)TaxRate.Takeaway,
            SaleContext.OnSite => TaxRate.OnSite,
            null => TaxRate.NonFood,
            _ => null
        };
        if (expectedTaxRate is not { } canonicalTaxRate
            || snapshot.TaxRate != canonicalTaxRate
            || (long)snapshot.UnitPriceHt.Cents * quantity != snapshot.AmountHt.Cents
            || (long)snapshot.AmountTtc.Cents != (long)snapshot.AmountHt.Cents + snapshot.Vat.Cents)
        {
            return false;
        }

        try
        {
            return snapshot.Vat.Cents == canonicalTaxRate.CalculateVat(snapshot.AmountHt).Cents;
        }
        catch (OverflowException)
        {
            return false;
        }
    }

    private static bool MatchesPersistedSnapshot(
        StockOperationEntity entity,
        SaleFinancialSnapshot payloadSnapshot)
    {
        if (entity.SaleFinancialUnitPriceHtCents is not { } unitPriceHtCents
            || entity.SaleFinancialTaxRateCode is not { } taxRateCode
            || entity.SaleFinancialTaxRateNumerator is not { } taxRateNumerator
            || entity.SaleFinancialTaxRateDenominator is not { } taxRateDenominator
            || entity.SaleFinancialAmountHtCents is not { } amountHtCents
            || entity.SaleFinancialVatCents is not { } vatCents
            || entity.SaleFinancialAmountTtcCents is not { } amountTtcCents)
        {
            return false;
        }

        try
        {
            var persistedSnapshot = new SaleFinancialSnapshot(
                entity.SaleFinancialContext switch
                {
                    null => null,
                    "takeaway" => SaleContext.Takeaway,
                    "onsite" => SaleContext.OnSite,
                    _ => throw new ArgumentException("Stored Sale financial context is invalid.")
                },
                Money.FromCents(unitPriceHtCents),
                new TaxRate(taxRateCode, taxRateNumerator, taxRateDenominator),
                Money.FromCents(amountHtCents),
                Money.FromCents(vatCents),
                Money.FromCents(amountTtcCents));
            return persistedSnapshot == payloadSnapshot;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }
}
