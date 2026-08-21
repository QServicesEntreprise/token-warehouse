using System.Globalization;
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

        app.MapPost("/api/supplies/bulk", async (
            HttpRequest request,
            IRecordBulkSupplyUseCase useCase,
            CancellationToken cancellationToken) =>
        {
            if (!IsJson(request.ContentType))
            {
                return BulkValidationProblem([
                    new ArticleValidationError(
                        "bulk_supply.request.content_type",
                        "body",
                        "Le corps doit utiliser le Content-Type application/json.")]);
            }

            BulkSupplyCommand? payload;
            try
            {
                payload = await ReadBulkCommandAsync(request, cancellationToken);
            }
            catch (JsonException exception)
            {
                return BulkValidationProblem([InvalidJsonError(exception, "bulk_supply")]);
            }

            if (payload is null)
            {
                return BulkValidationProblem([
                    new ArticleValidationError(
                        "bulk_supply.request.invalid",
                        "body",
                        "Le corps JSON doit être un objet contenant une collection lines.")]);
            }

            var result = await useCase.RecordBulkAsync(payload, cancellationToken);
            return result.Status switch
            {
                BulkSupplyStatus.Committed => Results.Created(
                    $"/api/supplies/bulk/{result.Receipt!.Operation.Id}",
                    BulkSupplyResponse.From(result.Receipt)),
                BulkSupplyStatus.NotFound => BulkProblem(
                    StatusCodes.Status404NotFound,
                    "Un Article de la livraison est introuvable.",
                    "bulk_supply.article.not_found",
                    result.Errors),
                BulkSupplyStatus.Conflict => BulkProblem(
                    StatusCodes.Status409Conflict,
                    "La livraison contient un conflit métier.",
                    result.Errors.All(error => error.Code == "article_archived")
                        ? "article_archived"
                        : "bulk_supply.conflict",
                    result.Errors),
                BulkSupplyStatus.PersistenceFailed => BulkProblem(
                    StatusCodes.Status500InternalServerError,
                    "La livraison n’a pas pu être enregistrée.",
                    "bulk_supply.persistence_failed",
                    result.Errors),
                _ => BulkValidationProblem(result.Errors)
            };
        });
    }

    private static async Task<BulkSupplyCommand?> ReadBulkCommandAsync(
        HttpRequest request,
        CancellationToken cancellationToken)
    {
        using var document = await JsonDocument.ParseAsync(request.Body, cancellationToken: cancellationToken);
        if (document.RootElement.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var root = document.RootElement;
        var unsupportedFields = root.EnumerateObject()
            .Where(property => property.Name != "lines")
            .Select(property => property.Name)
            .ToArray();
        if (!root.TryGetProperty("lines", out var lines))
        {
            return new BulkSupplyCommand { UnsupportedFields = unsupportedFields };
        }

        if (lines.ValueKind != JsonValueKind.Array)
        {
            return new BulkSupplyCommand
            {
                UnsupportedFields = unsupportedFields,
                StructuralErrors =
                [new(
                    "bulk_supply.lines.invalid",
                    "lines",
                    "La propriété lines doit être une collection de lignes.")]
            };
        }

        var commands = new List<BulkSupplyLineCommand>();
        foreach (var line in lines.EnumerateArray())
        {
            if (line.ValueKind != JsonValueKind.Object)
            {
                commands.Add(new() { IsObject = false });
                continue;
            }

            var unsupportedLineFields = line.EnumerateObject()
                .Where(property => property.Name is not ("ean13" or "quantity"))
                .Select(property => property.Name)
                .ToArray();
            var hasEan13 = line.TryGetProperty("ean13", out var ean);
            var ean13 = hasEan13
                && ean.ValueKind == JsonValueKind.String
                ? ean.GetString()
                : null;
            var hasQuantity = line.TryGetProperty("quantity", out var quantityElement);
            var quantity = hasQuantity
                && TryGetStrictInteger(quantityElement, out var parsedQuantity)
                ? (int?)parsedQuantity
                : null;
            commands.Add(new()
            {
                Ean13 = ean13,
                Quantity = quantity,
                Ean13Provided = hasEan13,
                QuantityProvided = hasQuantity,
                UnsupportedFields = unsupportedLineFields
            });
        }

        return new BulkSupplyCommand
        {
            Lines = commands,
            UnsupportedFields = unsupportedFields
        };
    }

    private static bool TryGetStrictInteger(JsonElement element, out int value)
    {
        value = 0;
        if (element.ValueKind != JsonValueKind.Number)
        {
            return false;
        }

        var raw = element.GetRawText();
        if (!int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
        {
            return false;
        }

        return !raw.Contains('.') && !raw.Contains('e') && !raw.Contains('E');
    }

    private static bool IsJson(string? contentType)
    {
        var mediaType = contentType?.Split(';', 2)[0].Trim();
        return string.Equals(mediaType, "application/json", StringComparison.OrdinalIgnoreCase)
            || (mediaType?.EndsWith("+json", StringComparison.OrdinalIgnoreCase) ?? false);
    }

    private static ArticleValidationError InvalidJsonError(
        JsonException? exception = null,
        string prefix = "supply")
    {
        var field = exception?.Path?
            .Split('.', StringSplitOptions.RemoveEmptyEntries)
            .LastOrDefault();
        var hasField = !string.IsNullOrWhiteSpace(field) && field != "$";

        return new(
            hasField ? $"{prefix}.{field}.invalid" : $"{prefix}.request.invalid",
            hasField ? field! : "body",
            "Le corps JSON est invalide ou contient un type de valeur inattendu.");
    }

    private static IResult ValidationProblem(IReadOnlyList<ArticleValidationError> errors)
        => SupplyProblem(StatusCodes.Status400BadRequest, "La requête d’Approvisionnement est invalide.", "supply.validation", errors);

    private static IResult BulkValidationProblem(IReadOnlyList<ArticleValidationError> errors)
        => BulkProblem(
            StatusCodes.Status400BadRequest,
            "La requête d’Approvisionnement en masse est invalide.",
            "bulk_supply.validation",
            errors);

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

    private static IResult BulkProblem(
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
                        StringComparer.Ordinal),
                ["errorCodes"] = errors
                    .GroupBy(error => error.Field, StringComparer.Ordinal)
                    .ToDictionary(
                        group => group.Key,
                        group => group.Select(error => error.Code).Distinct().ToArray(),
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

public sealed class BulkSupplyResponse
{
    public BulkSupplyOperationResponse Operation { get; init; } = new();

    public IReadOnlyList<StockPositionResponse> Positions { get; init; } = [];

    public static BulkSupplyResponse From(BulkSupplyReceipt receipt) => new()
    {
        Operation = BulkSupplyOperationResponse.From(receipt.Operation),
        Positions = receipt.Positions.Select(StockPositionResponse.From).ToArray()
    };
}

public sealed class BulkSupplyOperationResponse
{
    public string Id { get; init; } = string.Empty;

    public string Type { get; init; } = string.Empty;

    public DateTimeOffset OccurredAt { get; init; }

    public IReadOnlyList<BulkSupplyLineResponse> Lines { get; init; } = [];

    public static BulkSupplyOperationResponse From(StockOperation operation) => new()
    {
        Id = operation.Id,
        Type = "supply",
        OccurredAt = operation.OccurredAt,
        Lines = operation.Lines
            .Select(line => new BulkSupplyLineResponse(
                line.LineNumber,
                line.Ean13.Value,
                line.Quantity.Value))
            .ToArray()
    };
}

public sealed record BulkSupplyLineResponse(
    int LineNumber,
    string Ean13,
    int Quantity);
