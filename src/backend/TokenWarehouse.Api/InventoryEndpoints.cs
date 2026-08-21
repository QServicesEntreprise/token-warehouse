using System.Globalization;
using System.Text.Json;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Api;

public static class InventoryEndpoints
{
    public static void MapInventoryEndpoints(this WebApplication app)
    {
        app.MapPost("/api/inventories", async (
            HttpRequest request,
            IRegisterInventoryUseCase useCase,
            CancellationToken cancellationToken) =>
        {
            if (!IsJson(request.ContentType))
            {
                return InvalidInputProblem();
            }

            RegisterInventoryCommand? command;
            try
            {
                command = await ReadCommandAsync(request, cancellationToken);
            }
            catch (JsonException)
            {
                return InvalidInputProblem();
            }

            if (command is null)
            {
                return InvalidInputProblem();
            }

            var result = await useCase.RegisterAsync(command, cancellationToken);
            return result.Status switch
            {
                InventoryRegistrationStatus.Committed
                    => Results.Created(
                        $"/api/inventories/{result.Receipt!.Operation.Id}",
                        InventoryResponse.From(result.Receipt)),
                InventoryRegistrationStatus.ArticleNotFound => Problem(
                    StatusCodes.Status404NotFound,
                    "Article introuvable.",
                    "ARTICLE_NOT_FOUND"),
                InventoryRegistrationStatus.Conflict => Problem(
                    StatusCodes.Status409Conflict,
                    "La position Stock a changé pendant le comptage.",
                    "POSITION_CONFLICT"),
                InventoryRegistrationStatus.PersistenceFailed => Problem(
                    StatusCodes.Status500InternalServerError,
                    "La réconciliation n’a pas pu être enregistrée.",
                    "PERSISTENCE_FAILURE"),
                _ => InvalidInputProblem(result.Errors)
            };
        });

        app.MapGet("/api/inventories/{id}", async (
            string id,
            IReadInventoryUseCase useCase,
            CancellationToken cancellationToken) =>
        {
            var result = await useCase.GetAsync(id, cancellationToken);
            return result.Status switch
            {
                InventoryReadStatus.Found => Results.Ok(StockOperationResponse.From(result.Operation!)),
                InventoryReadStatus.PersistenceFailed => Problem(
                    StatusCodes.Status500InternalServerError,
                    "L’Inventaire n’a pas pu être relu.",
                    "PERSISTENCE_FAILURE"),
                _ => Problem(StatusCodes.Status404NotFound, "Inventaire introuvable.", "INVENTORY_NOT_FOUND")
            };
        });
    }

    private static async Task<RegisterInventoryCommand?> ReadCommandAsync(
        HttpRequest request,
        CancellationToken cancellationToken)
    {
        using var document = await JsonDocument.ParseAsync(request.Body, cancellationToken: cancellationToken);
        if (document.RootElement.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var properties = document.RootElement.EnumerateObject().ToArray();
        if (properties.Length != 2
            || properties.Any(property => property.Name is not ("ean13" or "countedQuantity")))
        {
            return null;
        }

        if (!document.RootElement.TryGetProperty("ean13", out var ean13)
            || ean13.ValueKind != JsonValueKind.String
            || !document.RootElement.TryGetProperty("countedQuantity", out var countedQuantity)
            || countedQuantity.ValueKind != JsonValueKind.Number
            || !int.TryParse(
                countedQuantity.GetRawText(),
                NumberStyles.Integer,
                CultureInfo.InvariantCulture,
                out var parsedQuantity))
        {
            return null;
        }

        return new RegisterInventoryCommand
        {
            Ean13 = ean13.GetString(),
            CountedQuantity = parsedQuantity
        };
    }

    private static bool IsJson(string? contentType)
    {
        var mediaType = contentType?.Split(';', 2)[0].Trim();
        return string.Equals(mediaType, "application/json", StringComparison.OrdinalIgnoreCase)
            || (mediaType?.EndsWith("+json", StringComparison.OrdinalIgnoreCase) ?? false);
    }

    private static IResult InvalidInputProblem(
        IReadOnlyList<ArticleValidationError>? errors = null)
        => Problem(
            StatusCodes.Status400BadRequest,
            "La requête d’Inventaire est invalide.",
            "INVALID_INPUT",
            errors);

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

public sealed record InventoryResponse(
    StockOperationResponse Operation,
    InventoryPositionResponse Position)
{
    public static InventoryResponse From(InventoryReceipt receipt)
        => new(
            StockOperationResponse.From(receipt.Operation),
            InventoryPositionResponse.From(receipt.Position));
}

public sealed record StockOperationResponse(
    string Id,
    string Type,
    string Ean13,
    int PreviousPhysicalStock,
    int CountedQuantity,
    int InventoryDifference,
    int ResultingPhysicalStock,
    DateTimeOffset TimestampUtc)
{
    public static StockOperationResponse From(StockOperation operation)
        => new(
            operation.Id,
            operation.Type == StockOperationType.Inventory ? "INVENTORY" : operation.Type.ToString().ToUpperInvariant(),
            operation.Ean13.Value,
            operation.PreviousPhysicalStock,
            operation.CountedQuantity,
            operation.InventoryDifference,
            operation.ResultingPhysicalStock,
            operation.TimestampUtc);
}

public sealed record InventoryPositionResponse(
    string Ean13,
    int PhysicalStock,
    int SellableStock,
    string Availability,
    string? Reason)
{
    public static InventoryPositionResponse From(StockPositionView position)
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
