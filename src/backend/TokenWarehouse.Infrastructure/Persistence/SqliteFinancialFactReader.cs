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
                .Where(fact => fact.Operation.Type == StockOperationType.Sale
                    || (fact.Operation.Type == StockOperationType.CounterMovement
                        && fact.Operation.SourceOperationType == StockOperationType.Sale))
                .Select(ToFact)
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

    private static SaleFinancialFact ToFact(StockOperationReadFact fact)
    {
        var operation = fact.Operation;
        if (operation.Type == StockOperationType.Sale)
        {
            if (fact.Financial is not { } financial)
            {
                throw new InvalidOperationException("Stored Sale financial snapshot is missing.");
            }

            return new(
                operation.Id,
                SaleFinancialFactType.Sale,
                operation.TimestampUtc,
                operation.Ean13,
                operation.Quantity.Value,
                financial.UnitPriceHt,
                financial.SaleContext,
                financial.TaxRate,
                financial.AmountHt,
                financial.Vat,
                financial.AmountTtc);
        }

        if (fact.FinancialReversal is not { } reversal
            || operation.SourceOperationId is null
            || operation.Lines.Count != 1
            || operation.Lines[0].InverseEffect <= 0)
        {
            throw new InvalidOperationException("Stored Sale financial reversal is invalid.");
        }

        return new(
            operation.Id,
            SaleFinancialFactType.CounterMovement,
            operation.TimestampUtc,
            operation.Ean13,
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
