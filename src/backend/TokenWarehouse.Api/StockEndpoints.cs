using System.Globalization;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Api;

public static class StockEndpoints
{
    public static void MapStockEndpoints(this WebApplication app)
    {
        app.MapGet("/api/stock", async (
            IReadStockUseCase useCase,
            CancellationToken cancellationToken) =>
        {
            var result = await useCase.ListAsync(cancellationToken);
            return Results.Ok(result.Positions.Select(StockPositionResponse.From).ToArray());
        });

        app.MapGet("/api/stock/{ean13}", async (
            string ean13,
            IReadStockUseCase useCase,
            CancellationToken cancellationToken) =>
        {
            var result = await useCase.GetAsync(ean13, cancellationToken);
            return result.Status switch
            {
                StockReadStatus.Success => Results.Ok(StockPositionResponse.From(result.Position!)),
                StockReadStatus.NotFound => NotFoundProblem(),
                _ => ValidationProblem(result.Errors)
            };
        });
    }

    private static IResult ValidationProblem(IReadOnlyList<ArticleValidationError> errors)
        => StockProblem(
            StatusCodes.Status400BadRequest,
            "La requête Stock est invalide.",
            "stock.validation",
            errors);

    private static IResult StockProblem(
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

    private static IResult NotFoundProblem()
        => Results.Problem(
            statusCode: StatusCodes.Status404NotFound,
            title: "Article introuvable.",
            extensions: new Dictionary<string, object?>
            {
                ["code"] = "stock.article.not_found"
            });
}

public sealed class StockPositionResponse
{
    public string Ean13 { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    public string Type { get; init; } = string.Empty;

    public bool IsActive { get; init; }

    public string Status { get; init; } = string.Empty;

    public int PhysicalQuantity { get; init; }

    public int SellableQuantity { get; init; }

    public string Availability { get; init; } = string.Empty;

    public string? Reason { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Dlc { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<string>? ConsumptionModes { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Packaging { get; init; }

    public static StockPositionResponse From(StockPositionView position) => new()
    {
        Ean13 = position.Ean13.Value,
        Name = position.Name,
        Type = position.Type == ArticleType.Food ? "food" : "nonFood",
        IsActive = position.IsActive,
        Status = position.IsActive ? "active" : "archived",
        PhysicalQuantity = position.PhysicalQuantity,
        SellableQuantity = position.SellableQuantity,
        Availability = position.Availability switch
        {
            StockAvailability.Available => "AVAILABLE",
            StockAvailability.OutOfStock => "OUT_OF_STOCK",
            _ => "NOT_SELLABLE"
        },
        Reason = position.Reason switch
        {
            SellabilityReason.Archived => "ARCHIVED",
            SellabilityReason.DlcExpired => "DLC_EXPIRED",
            SellabilityReason.UnsellablePackaging => "UNSELLABLE_PACKAGING",
            _ => null
        },
        Dlc = position.Type == ArticleType.Food
            ? position.Dlc?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            : null,
        ConsumptionModes = position.Type == ArticleType.Food
            ? position.ConsumptionModes.Select(mode => mode == ConsumptionMode.Takeaway ? "takeaway" : "onsite").ToArray()
            : null,
        Packaging = position.Type == ArticleType.NonFood && position.Packaging is { } packaging
            ? packaging switch
            {
                PackagingCondition.New => "new",
                PackagingCondition.Refurbished => "refurbished",
                _ => "unsellable"
            }
            : null
    };
}
