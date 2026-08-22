using TokenWarehouse.Domain;

namespace TokenWarehouse.Application;

public sealed record FinancialPeriod
{
    public FinancialPeriod(DateTimeOffset fromUtc, DateTimeOffset toUtc)
    {
        FromUtc = fromUtc.ToUniversalTime();
        ToUtc = toUtc.ToUniversalTime();
    }

    public DateTimeOffset FromUtc { get; }

    public DateTimeOffset ToUtc { get; }

    public bool IsValid => FromUtc <= ToUtc;

    public bool Contains(DateTimeOffset timestampUtc)
    {
        var timestamp = timestampUtc.ToUniversalTime();
        return timestamp >= FromUtc && timestamp < ToUtc;
    }
}

public enum SaleFinancialFactType
{
    Sale,
    CounterMovement
}

public sealed record SaleFinancialFact(
    string OperationId,
    SaleFinancialFactType Type,
    DateTimeOffset TimestampUtc,
    Ean13 Ean13,
    int Quantity,
    Money UnitPriceHt,
    SaleContext? SaleContext,
    TaxRate TaxRate,
    Money AmountHt,
    Money Vat,
    Money AmountTtc,
    string? SourceOperationId = null,
    string? Justification = null);

public static class SaleFinancialFactReader
{
    public static bool IsFinancial(StockOperationReadFact fact)
        => fact.Operation.Type == StockOperationType.Sale
            || (fact.Operation.Type == StockOperationType.CounterMovement
                && fact.Operation.SourceOperationType == StockOperationType.Sale);

    public static SaleFinancialFact From(StockOperationReadFact fact)
    {
        ArgumentNullException.ThrowIfNull(fact);

        var operation = fact.Operation;
        if (operation.Type == StockOperationType.Sale)
        {
            if (fact.Financial is not { } financial
                || !Ean13.TryCreate(operation.Ean13.Value, out var saleEan13))
            {
                throw new InvalidOperationException("Stored Sale financial snapshot is missing.");
            }

            return new(
                operation.Id,
                SaleFinancialFactType.Sale,
                operation.TimestampUtc,
                saleEan13,
                operation.Quantity.Value,
                financial.UnitPriceHt,
                financial.SaleContext,
                financial.TaxRate,
                financial.AmountHt,
                financial.Vat,
                financial.AmountTtc);
        }

        var reversal = fact.FinancialReversal ?? operation.FinancialReversal;
        if (reversal is null
            || operation.SourceOperationId is null
            || operation.Lines.Count != 1
            || operation.Lines[0].InverseEffect <= 0
            || !Ean13.TryCreate(operation.Ean13.Value, out var counterEan13))
        {
            throw new InvalidOperationException("Stored Sale financial reversal is invalid.");
        }

        return new(
            operation.Id,
            SaleFinancialFactType.CounterMovement,
            operation.TimestampUtc,
            counterEan13,
            operation.Lines[0].InverseEffect,
            reversal.UnitPriceHt,
            reversal.SaleContext,
            reversal.TaxRate,
            reversal.AmountHt,
            reversal.Vat,
            reversal.AmountTtc,
            operation.SourceOperationId,
            operation.Justification);
    }
}

public sealed record FinancialTaxRateSummary(
    TaxRate TaxRate,
    Money AmountHt,
    Money Vat,
    Money AmountTtc);

public sealed record FinancialSummary(
    Money RevenueHt,
    Money RevenueTtc,
    Money VatCollected,
    IReadOnlyList<FinancialTaxRateSummary> ByTaxRate)
{
    public static FinancialSummary Calculate(IEnumerable<SaleFinancialFact> facts)
    {
        ArgumentNullException.ThrowIfNull(facts);
        var factsArray = facts.ToArray();
        foreach (var fact in factsArray)
        {
            if ((long)fact.AmountTtc.Cents != (long)fact.AmountHt.Cents + fact.Vat.Cents)
            {
                throw new InvalidOperationException("Financial fact amounts are inconsistent.");
            }
        }

        var byTaxRate = new[]
        {
            TaxRate.Takeaway,
            TaxRate.OnSite,
            TaxRate.NonFood
        }
        .Select(taxRate => new FinancialTaxRateSummary(
            taxRate,
            Sum(factsArray.Where(fact => fact.TaxRate == taxRate).Select(fact => fact.AmountHt)),
            Sum(factsArray.Where(fact => fact.TaxRate == taxRate).Select(fact => fact.Vat)),
            Sum(factsArray.Where(fact => fact.TaxRate == taxRate).Select(fact => fact.AmountTtc))))
        .ToArray();

        return new(
            Sum(factsArray.Select(fact => fact.AmountHt)),
            Sum(factsArray.Select(fact => fact.AmountTtc)),
            Sum(factsArray.Select(fact => fact.Vat)),
            byTaxRate);
    }

    private static Money Sum(IEnumerable<Money> amounts)
        => Money.FromCents(checked(amounts.Sum(amount => amount.Cents)));
}

public enum FinancialFactReadStatus
{
    Success,
    PersistenceFailed
}

public sealed record FinancialFactReadResult(
    FinancialFactReadStatus Status,
    IReadOnlyList<SaleFinancialFact> Facts,
    IReadOnlyList<ArticleValidationError> Errors);

public interface IFinancialFactReader
{
    Task<FinancialFactReadResult> ReadAsync(
        FinancialPeriod period,
        CancellationToken cancellationToken = default);
}

public enum FinancialSummaryReadStatus
{
    Success,
    ValidationFailed,
    PersistenceFailed
}

public sealed record FinancialSummaryReadResult(
    FinancialSummaryReadStatus Status,
    FinancialSummary? Summary,
    IReadOnlyList<ArticleValidationError> Errors);

public interface IReadFinancialSummaryUseCase
{
    Task<FinancialSummaryReadResult> ReadAsync(
        FinancialPeriod period,
        CancellationToken cancellationToken = default);
}

public sealed class FinancialSummaryApplication(IFinancialFactReader reader)
    : IReadFinancialSummaryUseCase
{
    public async Task<FinancialSummaryReadResult> ReadAsync(
        FinancialPeriod period,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(period);
        if (!period.IsValid)
        {
            return new(
                FinancialSummaryReadStatus.ValidationFailed,
                null,
                [new(
                    "FINANCIAL_PERIOD_INVALID",
                    "period",
                    "La borne de début doit être antérieure ou égale à la borne de fin.")]);
        }

        try
        {
            var result = await reader.ReadAsync(period, cancellationToken);
            if (result.Status != FinancialFactReadStatus.Success)
            {
                return new(
                    FinancialSummaryReadStatus.PersistenceFailed,
                    null,
                    result.Errors);
            }

            var summary = FinancialSummary.Calculate(
                result.Facts.Where(fact => period.Contains(fact.TimestampUtc)));
            return new(FinancialSummaryReadStatus.Success, summary, []);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return new(
                FinancialSummaryReadStatus.PersistenceFailed,
                null,
                [new(
                    "FINANCIAL_READ_FAILURE",
                    "financial",
                    "Les faits financiers ne peuvent pas être lus pour le moment.")]);
        }
    }
}
