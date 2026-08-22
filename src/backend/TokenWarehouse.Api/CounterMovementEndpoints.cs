using System.Text.Json;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Api;

public static class CounterMovementEndpoints
{
    public static void MapCounterMovementEndpoints(this WebApplication app)
    {
        app.MapGet(
            "/api/stock/counter-movements/sources",
            async (
                IReadCorrectableStockOperationsUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var result = await useCase.ListAsync(cancellationToken);
                return result.Status == CorrectableStockOperationReadStatus.Success
                    ? Results.Ok(result.Sources.Select(CorrectableSourceResponse.From).ToArray())
                    : Problem(
                        StatusCodes.Status500InternalServerError,
                        "Les Opérations corrigeables ne peuvent pas être relues.",
                        "PERSISTENCE_FAILURE");
            });

        app.MapPost(
            "/api/stock/counter-movements",
            async (
                HttpRequest request,
                IRegisterCounterMovementUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                if (!IsJson(request.ContentType))
                {
                    return Problem(
                        StatusCodes.Status400BadRequest,
                        "La requête de Contre-mouvement est invalide.",
                        "INVALID_INPUT");
                }

                CounterMovementCommand? command;
                try
                {
                    command = await ReadCommandAsync(request, cancellationToken);
                }
                catch (JsonException)
                {
                    return Problem(
                        StatusCodes.Status400BadRequest,
                        "La requête de Contre-mouvement est invalide.",
                        "INVALID_INPUT");
                }

                if (command is null)
                {
                    return Problem(
                        StatusCodes.Status400BadRequest,
                        "La requête de Contre-mouvement est invalide.",
                        "INVALID_INPUT");
                }

                var result = await useCase.CorrectAsync(command, cancellationToken);
                return result.Status switch
                {
                    CounterMovementRegistrationStatus.Committed
                        => Results.Created(
                            $"/api/stock/counter-movements/{result.Receipt!.CounterMovement.Id}",
                            CounterMovementResponse.From(result.Receipt)),
                    CounterMovementRegistrationStatus.SourceNotFound
                        => Problem(StatusCodes.Status404NotFound, "Opération source introuvable.", "SOURCE_OPERATION_NOT_FOUND", result.Errors),
                    CounterMovementRegistrationStatus.PersistenceFailed
                        => Problem(StatusCodes.Status500InternalServerError, "Le Contre-mouvement n’a pas pu être enregistré.", "PERSISTENCE_FAILURE", result.Errors),
                    CounterMovementRegistrationStatus.ValidationFailed
                        => Problem(StatusCodes.Status400BadRequest, "La requête de Contre-mouvement est invalide.", "INVALID_INPUT", result.Errors),
                    _ => Problem(StatusCodes.Status409Conflict, "Le Contre-mouvement est en conflit.", result.Errors.FirstOrDefault()?.Code ?? "POSITION_CONFLICT", result.Errors)
                };
            });
    }

    private static async Task<CounterMovementCommand?> ReadCommandAsync(
        HttpRequest request,
        CancellationToken cancellationToken)
    {
        using var document = await JsonDocument.ParseAsync(request.Body, cancellationToken: cancellationToken);
        if (document.RootElement.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var properties = document.RootElement.EnumerateObject().ToArray();
        if (properties.Any(property => property.Name is not ("sourceOperationId" or "justification")))
        {
            return null;
        }

        var hasSource = document.RootElement.TryGetProperty("sourceOperationId", out var source);
        var hasJustification = document.RootElement.TryGetProperty("justification", out var justification);
        return new CounterMovementCommand
        {
            SourceOperationId = hasSource && source.ValueKind == JsonValueKind.String ? source.GetString() : null,
            Justification = hasJustification && justification.ValueKind == JsonValueKind.String
                ? justification.GetString()
                : null
        };
    }

    private static bool IsJson(string? contentType)
    {
        var mediaType = contentType?.Split(';', 2)[0].Trim();
        return string.Equals(mediaType, "application/json", StringComparison.OrdinalIgnoreCase)
            || (mediaType?.EndsWith("+json", StringComparison.OrdinalIgnoreCase) ?? false);
    }

    private static IResult Problem(
        int statusCode,
        string title,
        string code,
        IReadOnlyList<ArticleValidationError>? errors = null)
    {
        var extensions = new Dictionary<string, object?> { ["code"] = code };
        if (errors is { Count: > 0 })
        {
            extensions["errors"] = errors
                .GroupBy(error => error.Field, StringComparer.Ordinal)
                .ToDictionary(
                    group => group.Key,
                    group => group.Select(error => error.Message).ToArray(),
                    StringComparer.Ordinal);
        }

        return Results.Problem(statusCode: statusCode, title: title, extensions: extensions);
    }
}

public sealed record CounterMovementResponse(
    CounterMovementOperationResponse CounterMovement,
    CounterMovementSourceResponse Source,
    IReadOnlyList<CounterMovementPositionResponse> Positions)
{
    public static CounterMovementResponse From(CounterMovementReceipt receipt)
        => new(
            CounterMovementOperationResponse.From(receipt),
            CounterMovementSourceResponse.From(receipt.Source),
            receipt.Positions.Select(CounterMovementPositionResponse.From).ToArray());
}

public sealed record CounterMovementOperationResponse(
    string Id,
    string Type,
    DateTimeOffset TimestampUtc,
    string SourceOperationId,
    string SourceOperationType,
    string Justification,
    IReadOnlyList<CounterMovementLineResponse> Lines)
{
    public static CounterMovementOperationResponse From(CounterMovementReceipt receipt)
        => new(
            receipt.CounterMovement.Id,
            "COUNTER_MOVEMENT",
            receipt.CounterMovement.TimestampUtc,
            receipt.CounterMovement.SourceOperationId!,
            receipt.CounterMovement.SourceOperationType!.Value.ToString().ToUpperInvariant(),
            receipt.CounterMovement.Justification!,
            receipt.Lines.Select(line => new CounterMovementLineResponse(
                line.Operation.LineNumber,
                line.Operation.Ean13.Value,
                line.SourceEffect,
                line.InverseEffect)).ToArray());
}

public sealed record CounterMovementLineResponse(
    int LineNumber,
    string Ean13,
    int SourceEffect,
    int InverseEffect);

public sealed record CounterMovementSourceResponse(
    string Id,
    string Type,
    string Ean13,
    DateTimeOffset TimestampUtc,
    IReadOnlyList<CounterMovementSourceLineResponse> Lines)
{
    public static CounterMovementSourceResponse From(StockOperation source)
        => new(
            source.Id,
            source.Type.ToString().ToUpperInvariant(),
            source.Ean13.Value,
            source.TimestampUtc,
            source.Lines.Select(line => new CounterMovementSourceLineResponse(
                line.LineNumber,
                line.Ean13.Value,
                line.StockEffect)).ToArray());
}

public sealed record CounterMovementSourceLineResponse(
    int LineNumber,
    string Ean13,
    int StockEffect);

public sealed record CounterMovementPositionResponse(
    string Ean13,
    int PhysicalStock,
    int SellableStock,
    string Availability,
    string? Reason)
{
    public static CounterMovementPositionResponse From(StockPositionView position)
        => new(
            position.Ean13.Value,
            position.PhysicalQuantity,
            position.SellableQuantity,
            position.Availability switch
            {
                StockAvailability.Available => "AVAILABLE",
                StockAvailability.OutOfStock => "OUT_OF_STOCK",
                _ => "NOT_SELLABLE"
            },
            position.Reason switch
            {
                SellabilityReason.Archived => "ARCHIVED",
                SellabilityReason.DlcExpired => "DLC_EXPIRED",
                SellabilityReason.UnsellablePackaging => "UNSELLABLE_PACKAGING",
                _ => null
            });
}

public sealed record CorrectableSourceResponse(
    string Id,
    string Type,
    DateTimeOffset TimestampUtc,
    string Ean13,
    IReadOnlyList<CorrectableSourceLineResponse> Lines)
{
    public static CorrectableSourceResponse From(CorrectableStockOperationSummary source)
        => new(
            source.Id,
            source.Type,
            source.TimestampUtc,
            source.Ean13,
            source.Lines.Select(line => new CorrectableSourceLineResponse(
                line.LineNumber,
                line.Ean13,
                line.StockEffect)).ToArray());
}

public sealed record CorrectableSourceLineResponse(
    int LineNumber,
    string Ean13,
    int StockEffect);
