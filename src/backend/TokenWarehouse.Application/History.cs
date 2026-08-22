using TokenWarehouse.Domain;

namespace TokenWarehouse.Application;

public enum HistoryEntryType
{
    Supply,
    Inventory,
    SaleStock,
    CounterMovement,
    CatalogArchive,
    CatalogReactivate,
    CatalogDlcChange,
    CatalogPackagingChange,
    CatalogAttributeChange
}

public sealed record HistoryQuery(Ean13? Ean13 = null);

public sealed record HistoryArticleView(Ean13 Ean13);

public sealed record HistoryLineView
{
    public int LineNumber { get; init; }

    public Ean13 Ean13 { get; init; }

    public int? Quantity { get; init; }

    public int? PreviousPhysicalStock { get; init; }

    public int? CountedQuantity { get; init; }

    public int? Difference { get; init; }

    public int? StockEffect { get; init; }

    public int? InverseEffect { get; init; }

    public int? ResultingPhysicalStock { get; init; }
}

public sealed record HistoryChangeView(
    string Field,
    string? PreviousValue,
    string? NextValue);

public sealed record HistoryEntryView
{
    public string Id { get; init; } = string.Empty;

    // Compatibility fields kept while the existing Article consumers move to the richer read model.
    public string Ean13 { get; init; } = string.Empty;

    public HistoryEntryType Type { get; init; }

    public DateTimeOffset TimestampUtc { get; init; }

    public DateTimeOffset OccurredAt { get; init; }

    public IReadOnlyList<HistoryArticleView> Articles { get; init; } = [];

    public int? Quantity { get; init; }

    public int? StockEffect { get; init; }

    public int? PreviousPhysicalStock { get; init; }

    public int? CountedQuantity { get; init; }

    public int? Difference { get; init; }

    public int? ResultingPhysicalStock { get; init; }

    public IReadOnlyList<HistoryLineView> Lines { get; init; } = [];

    public string? SourceOperationId { get; init; }

    public string? SourceOperationType { get; init; }

    public string? Justification { get; init; }

    public string? CorrectedByOperationId { get; init; }

    public string? CorrectionOperationId { get; init; }

    public ArticleLifecycleStatus? PreviousStatus { get; init; }

    public ArticleLifecycleStatus? NextStatus { get; init; }

    public string? Kind { get; init; }

    public IReadOnlyList<HistoryChangeView> Changes { get; init; } = [];
}

public enum HistoryReadStatus
{
    Success,
    ValidationFailed,
    ArticleNotFound,
    PersistenceFailed
}

public sealed record HistoryReadResult(
    HistoryReadStatus Status,
    IReadOnlyList<HistoryEntryView> Entries,
    IReadOnlyList<ArticleValidationError> Errors);

public interface IHistoryReader
{
    ValueTask<HistoryReadResult> ReadAsync(
        HistoryQuery query,
        CancellationToken cancellationToken = default);
}

public interface IReadHistoryUseCase
{
    Task<HistoryReadResult> GetAsync(
        string? ean13 = null,
        CancellationToken cancellationToken = default);
}

public sealed class HistoryApplication(IHistoryReader reader) : IReadHistoryUseCase
{
    public async Task<HistoryReadResult> GetAsync(
        string? ean13 = null,
        CancellationToken cancellationToken = default)
    {
        Ean13? parsedEan13 = null;
        if (ean13 is not null)
        {
            if (!Ean13.TryCreate(ean13, out var parsed))
            {
                return new(
                    HistoryReadStatus.ValidationFailed,
                    [],
                    [new(
                        "INVALID_EAN13",
                        "ean13",
                        "L’EAN-13 doit contenir 13 chiffres et un checksum valide.")]);
            }

            parsedEan13 = parsed;
        }

        try
        {
            return await reader.ReadAsync(new HistoryQuery(parsedEan13), cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return new(
                HistoryReadStatus.PersistenceFailed,
                [],
                [new(
                    "HISTORY_READ_FAILURE",
                    "history",
                    "L’Historique ne peut pas être lu pour le moment.")]);
        }
    }
}
