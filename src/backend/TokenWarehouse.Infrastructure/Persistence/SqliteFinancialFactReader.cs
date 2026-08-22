using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteFinancialFactReader(
    IStockOperationReader operationReader) : IFinancialFactReader
{
    public async Task<FinancialFactReadResult> ReadAsync(
        FinancialPeriod period,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(period);
        if (!period.IsValid)
        {
            return new(
                FinancialFactReadStatus.PersistenceFailed,
                [],
                [new(
                    "FINANCIAL_PERIOD_INVALID",
                    "period",
                    "La période financière est invalide.")]);
        }

        try
        {
            var operations = await operationReader.ListForFinancialAsync(cancellationToken);
            var facts = operations
                .Where(SaleFinancialFactReader.IsFinancial)
                .Select(SaleFinancialFactReader.From)
                .Where(fact => period.Contains(fact.TimestampUtc))
                .OrderBy(fact => fact.TimestampUtc)
                .ThenBy(fact => fact.OperationId, StringComparer.Ordinal)
                .ToArray();
            return new(FinancialFactReadStatus.Success, facts, []);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return new(
                FinancialFactReadStatus.PersistenceFailed,
                [],
                [new(
                    "FINANCIAL_READ_FAILURE",
                    "financial",
                    "Les faits financiers ne peuvent pas être lus pour le moment.")]);
        }
    }

}
