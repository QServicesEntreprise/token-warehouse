using TokenWarehouse.Domain;

namespace TokenWarehouse.Application;

public sealed record StockOperationLineReadView(
    int LineNumber,
    string Ean13,
    int Quantity,
    int PreviousPhysicalStock,
    int CountedQuantity,
    int InventoryDifference,
    int ResultingPhysicalStock,
    int StockEffect,
    int InverseEffect);

public sealed record StockOperationReadFact(
    StockOperation Operation,
    SaleContext? SaleContext = null,
    SaleFinancialSnapshot? Financial = null,
    SaleFinancialReversal? FinancialReversal = null);

public sealed record StockOperationReadView(
    string Id,
    StockOperationType Type,
    string Ean13,
    int Quantity,
    DateTimeOffset TimestampUtc,
    string? SourceOperationId,
    StockOperationType? SourceOperationType,
    string? Justification,
    IReadOnlyList<StockOperationLineReadView> Lines,
    SaleContext? SaleContext = null,
    SaleFinancialSnapshot? Financial = null,
    SaleFinancialReversal? FinancialReversal = null)
{
    public static StockOperationReadView From(StockOperationReadFact fact)
    {
        ArgumentNullException.ThrowIfNull(fact);
        var operation = fact.Operation;
        return new(
            operation.Id,
            operation.Type,
            operation.Ean13.Value,
            operation.Quantity.Value,
            operation.TimestampUtc,
            operation.SourceOperationId,
            operation.SourceOperationType,
            operation.Justification,
            operation.Lines
                .OrderBy(line => line.LineNumber)
                .Select(line => new StockOperationLineReadView(
                    line.LineNumber,
                    line.Ean13.Value,
                    line.Quantity.Value,
                    line.PreviousPhysicalStock,
                    line.CountedQuantity,
                    line.InventoryDifference,
                    line.ResultingPhysicalStock,
                    line.StockEffect,
                    line.InverseEffect))
            .ToArray(),
            fact.SaleContext,
            fact.Financial,
            fact.FinancialReversal ?? operation.FinancialReversal);
    }
}

public enum StockOperationReadStatus
{
    Success,
    PersistenceFailed
}

public sealed record StockOperationReadResult(
    StockOperationReadStatus Status,
    IReadOnlyList<StockOperationReadView> Operations);

public interface IStockOperationReadContract
{
    Task<StockOperationReadResult> ListAsync(CancellationToken cancellationToken = default);

    Task<StockOperationReadResult> ListForDashboardAsync(
        CancellationToken cancellationToken = default)
        => ListAsync(cancellationToken);
}

public sealed class StockOperationReadApplication(IStockOperationReader reader)
    : IStockOperationReadContract
{
    public async Task<StockOperationReadResult> ListAsync(
        CancellationToken cancellationToken = default)
    {
        try
        {
            var operations = await reader.ListAsync(cancellationToken);
            return ToResult(operations.Select(operation => new StockOperationReadFact(operation)));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return new(StockOperationReadStatus.PersistenceFailed, []);
        }
    }

    public async Task<StockOperationReadResult> ListForDashboardAsync(
        CancellationToken cancellationToken = default)
    {
        try
        {
            return ToResult(await reader.ListForDashboardAsync(cancellationToken));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return new(StockOperationReadStatus.PersistenceFailed, []);
        }
    }

    private static StockOperationReadResult ToResult(
        IEnumerable<StockOperationReadFact> operations)
        => new(
            StockOperationReadStatus.Success,
            operations
                .OrderBy(operation => operation.Operation.TimestampUtc)
                .ThenBy(operation => operation.Operation.Id, StringComparer.Ordinal)
                .Select(ToView)
                .ToArray());

    private static StockOperationReadView ToView(StockOperationReadFact fact)
        => StockOperationReadView.From(fact);
}
