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

    public static SaleFinancialReversal ReadReversal(
        StockOperationEntity counterMovement,
        IReadOnlyList<StockOperationLineEntity> counterMovementLines,
        StockOperationEntity sourceSale)
    {
        ArgumentNullException.ThrowIfNull(counterMovement);
        ArgumentNullException.ThrowIfNull(counterMovementLines);
        ArgumentNullException.ThrowIfNull(sourceSale);

        var sourceSnapshot = Read(sourceSale, out _);
        if (!MatchesSaleSource(
                counterMovement,
                counterMovementLines,
                sourceSale)
            || !SaleFinancialReversalSerializer.TryDeserialize(
                counterMovement.SaleCommitDataType,
                counterMovement.SaleCommitDataPayload,
                out var reversal)
            || reversal.SourceOperationId != sourceSale.Id
            || reversal != SaleFinancialReversalPolicy.Create(sourceSale.Id, sourceSnapshot))
        {
            throw new InvalidOperationException("Stored Sale financial reversal data is invalid.");
        }

        return reversal;
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

    private static bool MatchesSaleSource(
        StockOperationEntity counterMovement,
        IReadOnlyList<StockOperationLineEntity> counterMovementLines,
        StockOperationEntity sourceSale)
    {
        if (!string.Equals(sourceSale.Type, "SALE", StringComparison.OrdinalIgnoreCase)
            || !string.Equals(counterMovement.Type, "COUNTER_MOVEMENT", StringComparison.Ordinal)
            || !string.Equals(counterMovement.SourceOperationType, "SALE", StringComparison.OrdinalIgnoreCase)
            || !string.Equals(counterMovement.SourceOperationId, sourceSale.Id, StringComparison.Ordinal)
            || !Ean13.TryCreate(sourceSale.Ean13, out var sourceEan13)
            || !Ean13.TryCreate(counterMovement.Ean13, out var counterEan13)
            || sourceEan13 != counterEan13
            || sourceSale.Quantity <= 0
            || !MatchesSourceLines(sourceSale, sourceEan13)
            || counterMovementLines.Count != 1)
        {
            return false;
        }

        var counterLine = counterMovementLines[0];
        return counterLine.LineNumber == 1
            && counterLine.Ean13 == sourceEan13.Value
            && counterLine.Quantity == 0
            && counterLine.SourceEffect == -sourceSale.Quantity
            && counterLine.InverseEffect == sourceSale.Quantity;
    }

    private static bool MatchesSourceLines(
        StockOperationEntity sourceSale,
        Ean13 sourceEan13)
    {
        var sourceLines = sourceSale.Lines
            .OrderBy(line => line.LineNumber)
            .ToArray();
        return sourceLines.Length == 0
            || (sourceLines.Length == 1
                && sourceLines[0].LineNumber == 1
                && sourceLines[0].Ean13 == sourceEan13.Value
                && sourceLines[0].Quantity == sourceSale.Quantity
                && sourceLines[0].SourceEffect == -sourceSale.Quantity);
    }
}
