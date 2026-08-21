using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Api;

public static class SupplyEndpoints
{
    public static void MapSupplyEndpoints(this WebApplication app)
    {
        app.MapPost("/api/supplies", async (
            HttpRequest request,
            IRecordSupplyUseCase useCase,
            CancellationToken cancellationToken) =>
        {
            if (!IsJson(request.ContentType))
            {
                return ValidationProblem([
                    new ArticleValidationError(
                        "supply.request.content_type",
                        "body",
                        "Le corps doit utiliser le Content-Type application/json.")]);
            }

            SupplyRequest? payload;
            try
            {
                payload = await request.ReadFromJsonAsync<SupplyRequest>(cancellationToken);
            }
            catch (JsonException exception)
            {
                return ValidationProblem([InvalidJsonError(exception)]);
            }
            catch (NotSupportedException)
            {
                return ValidationProblem([InvalidJsonError()]);
            }

            if (payload is null)
            {
                return ValidationProblem([
                    new ArticleValidationError(
                        "supply.request.required",
                        "body",
                        "Le corps JSON est requis.")]);
            }

            var result = await useCase.RecordAsync(payload.ToCommand(), cancellationToken);
            return result.Status switch
            {
                SupplyStatus.Committed => Results.Created(
                    $"/api/supplies/{result.Receipt!.Operation.Id}",
                    SupplyResponse.From(result.Receipt)),
                SupplyStatus.NotFound => NotFoundProblem(),
                SupplyStatus.Conflict => ConflictProblem(result.Errors),
                _ => ValidationProblem(result.Errors)
            };
        });
    }

    private static bool IsJson(string? contentType)
    {
        var mediaType = contentType?.Split(';', 2)[0].Trim();
        return string.Equals(mediaType, "application/json", StringComparison.OrdinalIgnoreCase)
            || (mediaType?.EndsWith("+json", StringComparison.OrdinalIgnoreCase) ?? false);
    }

    private static ArticleValidationError InvalidJsonError(JsonException? exception = null)
    {
        var field = exception?.Path?
            .Split('.', StringSplitOptions.RemoveEmptyEntries)
            .LastOrDefault();
        var hasField = !string.IsNullOrWhiteSpace(field) && field != "$";

        return new(
            hasField ? $"supply.{field}.invalid" : "supply.request.invalid",
            hasField ? field! : "body",
            "Le corps JSON est invalide ou contient un type de valeur inattendu.");
    }

    private static IResult ValidationProblem(IReadOnlyList<ArticleValidationError> errors)
        => SupplyProblem(StatusCodes.Status400BadRequest, "La requête d’Approvisionnement est invalide.", "supply.validation", errors);

    private static IResult ConflictProblem(IReadOnlyList<ArticleValidationError> errors)
    {
        var error = errors.FirstOrDefault();
        return SupplyProblem(
            StatusCodes.Status409Conflict,
            error?.Message ?? "L’Approvisionnement est en conflit.",
            error?.Code ?? "supply.conflict",
            errors);
    }

    private static IResult NotFoundProblem()
        => Results.Problem(
            statusCode: StatusCodes.Status404NotFound,
            title: "Article introuvable.",
            extensions: new Dictionary<string, object?>
            {
                ["code"] = "supply.article.not_found"
            });

    private static IResult SupplyProblem(
        int statusCode,
        string title,
        string code,
        IReadOnlyList<ArticleValidationError> errors)
        => Results.Problem(
            statusCode: statusCode,
            title: title,
            extensions: new Dictionary<string, object?>
            {
                ["code"] = code,
                ["errors"] = errors
                    .GroupBy(error => error.Field, StringComparer.Ordinal)
                    .ToDictionary(
                        group => group.Key,
                        group => group.Select(error => error.Message).ToArray(),
                        StringComparer.Ordinal)
            });
}

public sealed class SupplyRequest
{
    [JsonPropertyName("ean13")]
    public string? Ean13 { get; set; }

    [JsonPropertyName("quantity")]
    public int? Quantity { get; set; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? AdditionalProperties { get; set; }

    public SupplyCommand ToCommand() => new()
    {
        Ean13 = Ean13,
        Quantity = Quantity,
        UnsupportedFields = AdditionalProperties?.Keys.ToArray() ?? []
    };
}

public sealed class SupplyResponse
{
    public SupplyOperationResponse Operation { get; init; } = new();

    public StockPositionResponse Position { get; init; } = new();

    public static SupplyResponse From(SupplyReceipt receipt) => new()
    {
        Operation = SupplyOperationResponse.From(receipt.Operation),
        Position = StockPositionResponse.From(receipt.Position)
    };
}

public sealed class SupplyOperationResponse
{
    public string Id { get; init; } = string.Empty;

    public string Type { get; init; } = string.Empty;

    public string Ean13 { get; init; } = string.Empty;

    public int Quantity { get; init; }

    public DateTimeOffset OccurredAt { get; init; }

    public static SupplyOperationResponse From(TokenWarehouse.Domain.StockOperation operation) => new()
    {
        Id = operation.Id,
        Type = "supply",
        Ean13 = operation.Ean13.Value,
        Quantity = operation.Quantity.Value,
        OccurredAt = operation.OccurredAt
    };
}
