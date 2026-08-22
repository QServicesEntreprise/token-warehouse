using System.Text.Json.Serialization;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Api;

public static class HistoryEndpoints
{
    public static void MapHistoryEndpoints(this WebApplication app)
    {
        app.MapGet("/api/history", async (
            string? ean13,
            IReadHistoryUseCase useCase,
            CancellationToken cancellationToken) =>
        {
            var result = await useCase.GetAsync(ean13, cancellationToken);
            return result.Status switch
            {
                HistoryReadStatus.Success
                    => Results.Ok(result.Entries.Select(HistoryEntryResponse.From).ToArray()),
                HistoryReadStatus.ArticleNotFound => Problem(
                    StatusCodes.Status404NotFound,
                    "ARTICLE_NOT_FOUND",
                    "L’Article demandé est introuvable."),
                HistoryReadStatus.PersistenceFailed => Problem(
                    StatusCodes.Status500InternalServerError,
                    "HISTORY_READ_FAILURE",
                    "L’Historique ne peut pas être lu pour le moment."),
                _ => ValidationProblem(result)
            };
        });
    }

    private static IResult ValidationProblem(HistoryReadResult result)
    {
        var error = result.Errors.FirstOrDefault();
        return Results.Problem(
            statusCode: StatusCodes.Status400BadRequest,
            title: error?.Message ?? "La requête d’Historique est invalide.",
            extensions: new Dictionary<string, object?>
            {
                ["code"] = error?.Code ?? "INVALID_EAN13",
                ["errors"] = result.Errors
                    .GroupBy(item => item.Field, StringComparer.Ordinal)
                    .ToDictionary(
                        group => group.Key,
                        group => group.Select(item => item.Message).ToArray(),
                        StringComparer.Ordinal)
            });
    }

    private static IResult Problem(int statusCode, string code, string title)
        => Results.Problem(
            statusCode: statusCode,
            title: title,
            extensions: new Dictionary<string, object?>
            {
                ["code"] = code
            });
}

public sealed class HistoryEntryResponse
{
    public string Id { get; init; } = string.Empty;

    public string Type { get; init; } = string.Empty;

    public DateTimeOffset TimestampUtc { get; init; }

    public DateTimeOffset OccurredAt { get; init; }

    public string Ean13 { get; init; } = string.Empty;

    public IReadOnlyList<HistoryArticleResponse> Articles { get; init; } = [];

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Quantity { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? StockEffect { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? PreviousPhysicalStock { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? CountedQuantity { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Difference { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? ResultingPhysicalStock { get; init; }

    public IReadOnlyList<HistoryLineResponse> Lines { get; init; } = [];

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? SourceOperationId { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? SourceOperationType { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Justification { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public SaleFinancialResponse? Financial { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public SaleFinancialReversalResponse? FinancialReversal { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? CorrectedByOperationId { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? CorrectionOperationId { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? PreviousStatus { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? NextStatus { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Kind { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<HistoryChangeResponse>? Changes { get; init; }

    public static HistoryEntryResponse From(HistoryEntryView entry) => new()
    {
        Id = entry.Id,
        Type = ToWireType(entry.Type),
        TimestampUtc = entry.TimestampUtc,
        OccurredAt = entry.OccurredAt,
        Ean13 = entry.Ean13,
        Articles = entry.Articles.Select(article => new HistoryArticleResponse
        {
            Ean13 = article.Ean13.Value
        }).ToArray(),
        Quantity = entry.Quantity,
        StockEffect = entry.StockEffect,
        PreviousPhysicalStock = entry.PreviousPhysicalStock,
        CountedQuantity = entry.CountedQuantity,
        Difference = entry.Difference,
        ResultingPhysicalStock = entry.ResultingPhysicalStock,
        Lines = entry.Lines.Select(HistoryLineResponse.From).ToArray(),
        SourceOperationId = entry.SourceOperationId,
        SourceOperationType = entry.SourceOperationType,
        Justification = entry.Justification,
        Financial = entry.Financial is { } financial
            ? SaleFinancialResponse.From(financial)
            : null,
        FinancialReversal = entry.FinancialReversal is { } reversal
            ? SaleFinancialReversalResponse.From(reversal)
            : null,
        CorrectedByOperationId = entry.CorrectedByOperationId,
        CorrectionOperationId = entry.CorrectionOperationId,
        PreviousStatus = entry.PreviousStatus is { } previous
            ? ToWireStatus(previous)
            : null,
        NextStatus = entry.NextStatus is { } next
            ? ToWireStatus(next)
            : null,
        Kind = entry.Kind,
        Changes = entry.Changes.Count == 0
            ? null
            : entry.Changes.Select(HistoryChangeResponse.From).ToArray()
    };

    private static string ToWireType(HistoryEntryType type)
        => type switch
        {
            HistoryEntryType.Supply => "SUPPLY",
            HistoryEntryType.Inventory => "INVENTORY",
            HistoryEntryType.SaleStock => "SALE_STOCK",
            HistoryEntryType.CounterMovement => "COUNTER_MOVEMENT",
            HistoryEntryType.CatalogArchive => "CATALOG_ARCHIVE",
            HistoryEntryType.CatalogReactivate => "CATALOG_REACTIVATE",
            HistoryEntryType.CatalogDlcChange => "CATALOG_DLC_CHANGE",
            HistoryEntryType.CatalogPackagingChange => "CATALOG_PACKAGING_CHANGE",
            _ => "CATALOG_ATTRIBUTE_CHANGE"
        };

    private static string ToWireStatus(ArticleLifecycleStatus status)
        => status == ArticleLifecycleStatus.Active ? "active" : "archived";
}

public sealed class HistoryArticleResponse
{
    public string Ean13 { get; init; } = string.Empty;
}

public sealed class HistoryLineResponse
{
    public int LineNumber { get; init; }

    public string Ean13 { get; init; } = string.Empty;

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Quantity { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? PreviousPhysicalStock { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? CountedQuantity { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Difference { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? StockEffect { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? InverseEffect { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? ResultingPhysicalStock { get; init; }

    public static HistoryLineResponse From(HistoryLineView line) => new()
    {
        LineNumber = line.LineNumber,
        Ean13 = line.Ean13.Value,
        Quantity = line.Quantity,
        PreviousPhysicalStock = line.PreviousPhysicalStock,
        CountedQuantity = line.CountedQuantity,
        Difference = line.Difference,
        StockEffect = line.StockEffect,
        InverseEffect = line.InverseEffect,
        ResultingPhysicalStock = line.ResultingPhysicalStock
    };
}

public sealed class HistoryChangeResponse
{
    public string Field { get; init; } = string.Empty;

    public string? Before { get; init; }

    public string? After { get; init; }

    // Keep the existing Article history field names available to current clients.
    public string? PreviousValue { get; init; }

    public string? NextValue { get; init; }

    public static HistoryChangeResponse From(HistoryChangeView change) => new()
    {
        Field = change.Field,
        Before = change.PreviousValue,
        After = change.NextValue,
        PreviousValue = change.PreviousValue,
        NextValue = change.NextValue
    };
}
