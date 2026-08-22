using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Infrastructure.Persistence;

public interface ISqliteStockSaleCommitDataAdapter
{
    bool CanHandle(string type);

    void Apply(StockOperationEntity operation, StockSaleCommitData data);
}

public sealed class SqliteSaleFinancialSnapshotCommitDataAdapter
    : ISqliteStockSaleCommitDataAdapter
{
    public bool CanHandle(string type)
        => string.Equals(type, SaleFinancialSnapshotSerializer.Type, StringComparison.Ordinal);

    public void Apply(StockOperationEntity operation, StockSaleCommitData data)
    {
        if (!string.Equals(operation.Type, "SALE", StringComparison.Ordinal)
            || !SaleFinancialSnapshotSerializer.TryDeserialize(data.Type, data.Payload, out var snapshot))
        {
            throw new InvalidOperationException("Sale financial snapshot data is invalid.");
        }

        operation.SaleFinancialContext = snapshot.SaleContext switch
        {
            SaleContext.Takeaway => "takeaway",
            SaleContext.OnSite => "onsite",
            _ => null
        };
        operation.SaleFinancialUnitPriceHtCents = snapshot.UnitPriceHt.Cents;
        operation.SaleFinancialTaxRateCode = snapshot.TaxRate.Code;
        operation.SaleFinancialTaxRateNumerator = snapshot.TaxRate.Numerator;
        operation.SaleFinancialTaxRateDenominator = snapshot.TaxRate.Denominator;
        operation.SaleFinancialAmountHtCents = snapshot.AmountHt.Cents;
        operation.SaleFinancialVatCents = snapshot.Vat.Cents;
        operation.SaleFinancialAmountTtcCents = snapshot.AmountTtc.Cents;
    }
}
