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

public sealed record StockOperationReadView(
    string Id,
    StockOperationType Type,
    string Ean13,
    int Quantity,
    DateTimeOffset TimestampUtc,
    string? SourceOperationId,
    StockOperationType? SourceOperationType,
    string? Justification,
    IReadOnlyList<StockOperationLineReadView> Lines);

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
            return new(
                StockOperationReadStatus.Success,
                operations
                    .OrderBy(operation => operation.TimestampUtc)
                    .ThenBy(operation => operation.Id, StringComparer.Ordinal)
                    .Select(ToView)
                    .ToArray());
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

    private static StockOperationReadView ToView(StockOperation operation)
        => new(
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
                .ToArray());
}
