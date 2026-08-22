using TokenWarehouse.Application;
using TokenWarehouse.Domain;
using Xunit;

namespace TokenWarehouse.Application.Tests;

public sealed class FinancialSummaryTests
{
    [Fact]
    public void Keeps_all_three_tax_rate_lines_for_an_empty_period()
    {
        var summary = FinancialSummary.Calculate([]);

        Assert.Equal((0, 0, 0), (
            summary.RevenueHt.Cents,
            summary.VatCollected.Cents,
            summary.RevenueTtc.Cents));
        Assert.Equal([TaxRate.Takeaway, TaxRate.OnSite, TaxRate.NonFood], summary.ByTaxRate.Select(line => line.TaxRate));
        Assert.All(summary.ByTaxRate, line => Assert.Equal((0, 0, 0), (
            line.AmountHt.Cents,
            line.Vat.Cents,
            line.AmountTtc.Cents)));
    }

    [Fact]
    public void Aggregates_signed_facts_for_all_supported_tax_rates_without_recalculating_amounts()
    {
        var facts = new[]
        {
            Fact(
                "sale-takeaway",
                SaleFinancialFactType.Sale,
                "2030-01-15T10:00:00Z",
                TaxRate.Takeaway,
                SaleContext.Takeaway,
                1000,
                55,
                1055),
            Fact(
                "sale-onsite",
                SaleFinancialFactType.Sale,
                "2030-01-15T10:01:00Z",
                TaxRate.OnSite,
                SaleContext.OnSite,
                1000,
                100,
                1100),
            Fact(
                "counter-non-food",
                SaleFinancialFactType.CounterMovement,
                "2030-01-15T10:02:00Z",
                TaxRate.NonFood,
                null,
                -1000,
                -200,
                -1200,
                "sale-non-food"),
        };

        var summary = FinancialSummary.Calculate(facts);

        Assert.Equal(1000, summary.RevenueHt.Cents);
        Assert.Equal(-45, summary.VatCollected.Cents);
        Assert.Equal(955, summary.RevenueTtc.Cents);
        Assert.Equal(
            [
                new FinancialTaxRateSummary(
                    TaxRate.Takeaway,
                    Money.FromCents(1000),
                    Money.FromCents(55),
                    Money.FromCents(1055)),
                new FinancialTaxRateSummary(
                    TaxRate.OnSite,
                    Money.FromCents(1000),
                    Money.FromCents(100),
                    Money.FromCents(1100)),
                new FinancialTaxRateSummary(
                    TaxRate.NonFood,
                    Money.FromCents(-1000),
                    Money.FromCents(-200),
                    Money.FromCents(-1200))
            ],
            summary.ByTaxRate);
    }

    [Fact]
    public async Task Reads_only_facts_in_the_explicit_utc_period_with_inclusive_from_and_exclusive_to()
    {
        var reader = new RecordingFinancialFactReader(
            [
                Fact(
                    "at-from",
                    SaleFinancialFactType.Sale,
                    "2030-01-15T10:00:00Z",
                    TaxRate.Takeaway,
                    SaleContext.Takeaway,
                    1000,
                    55,
                    1055),
                Fact(
                    "at-to",
                    SaleFinancialFactType.Sale,
                    "2030-01-15T11:00:00Z",
                    TaxRate.OnSite,
                    SaleContext.OnSite,
                    1000,
                    100,
                    1100)
            ]);
        var application = new FinancialSummaryApplication(reader);

        var result = await application.ReadAsync(new FinancialPeriod(
            DateTimeOffset.Parse("2030-01-15T10:00:00Z"),
            DateTimeOffset.Parse("2030-01-15T11:00:00Z")));

        Assert.Equal(FinancialSummaryReadStatus.Success, result.Status);
        Assert.Equal(1000, result.Summary!.RevenueHt.Cents);
        Assert.Equal(55, result.Summary.VatCollected.Cents);
        Assert.Equal(["at-from"], reader.LastFacts!.Select(fact => fact.OperationId));
    }

    [Fact]
    public async Task Rejects_a_reversed_period_before_reading_financial_facts()
    {
        var reader = new RecordingFinancialFactReader([]);
        var application = new FinancialSummaryApplication(reader);

        var result = await application.ReadAsync(new FinancialPeriod(
            DateTimeOffset.Parse("2030-01-16T00:00:00Z"),
            DateTimeOffset.Parse("2030-01-15T00:00:00Z")));

        Assert.Equal(FinancialSummaryReadStatus.ValidationFailed, result.Status);
        Assert.Contains(result.Errors, error => error.Code == "FINANCIAL_PERIOD_INVALID");
        Assert.Equal(0, reader.Calls);
    }

    private static SaleFinancialFact Fact(
        string operationId,
        SaleFinancialFactType type,
        string timestamp,
        TaxRate taxRate,
        SaleContext? saleContext,
        int amountHt,
        int vat,
        int amountTtc,
        string? sourceOperationId = null)
        => new(
            operationId,
            type,
            DateTimeOffset.Parse(timestamp),
            Ean("0123456789012"),
            1,
            Money.FromCents(1000),
            saleContext,
            taxRate,
            Money.FromCents(amountHt),
            Money.FromCents(vat),
            Money.FromCents(amountTtc),
            sourceOperationId,
            type == SaleFinancialFactType.CounterMovement ? "Correction" : null);

    private static Ean13 Ean(string value)
        => Ean13.TryCreate(value, out var ean13)
            ? ean13
            : throw new InvalidOperationException("Invalid test EAN.");

    private sealed class RecordingFinancialFactReader(
        IReadOnlyList<SaleFinancialFact> facts) : IFinancialFactReader
    {
        public int Calls { get; private set; }

        public IReadOnlyList<SaleFinancialFact>? LastFacts { get; private set; }

        public Task<FinancialFactReadResult> ReadAsync(
            FinancialPeriod period,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            LastFacts = facts.Where(fact => period.Contains(fact.TimestampUtc)).ToArray();
            return Task.FromResult(new FinancialFactReadResult(
                FinancialFactReadStatus.Success,
                LastFacts,
                []));
        }
    }
}
