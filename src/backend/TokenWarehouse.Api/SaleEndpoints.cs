using System.Text.Json;
using System.Text.Json.Serialization;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Api;

public static class SaleEndpoints
{
    public static void MapSaleEndpoints(this WebApplication app)
    {
        app.MapGet("/api/sales/articles", async (
            string? search,
            ISaleContract useCase,
            CancellationToken cancellationToken) =>
        {
            var result = await useCase.SearchArticlesAsync(search, cancellationToken);
            return result.Status == SaleArticleSearchStatus.PersistenceFailed
                ? Problem(
                    StatusCodes.Status500InternalServerError,
                    "La recherche des Articles est indisponible.",
                    "INTERNAL_ERROR",
                    [])
                : Results.Ok(result.Articles.Select(SaleArticleResponse.From).ToArray());
        });

        app.MapPost("/api/sales", async (
            HttpRequest request,
            ISaleContract useCase,
            CancellationToken cancellationToken) =>
        {
            if (!IsJson(request.ContentType))
            {
                return Problem(
                    StatusCodes.Status400BadRequest,
                    "La requête est invalide.",
                    "INVALID_INPUT",
                    [new ArticleValidationError(
                        "INVALID_INPUT",
                        "body",
                        "Le corps doit utiliser le Content-Type application/json.")]);
            }

            SaleCommand? command;
            IReadOnlyList<ArticleValidationError> parseErrors;
            try
            {
                (command, parseErrors) = await ParseCommandAsync(request, cancellationToken);
            }
            catch (JsonException)
            {
                return Problem(
                    StatusCodes.Status400BadRequest,
                    "La requête est invalide.",
                    "INVALID_INPUT",
                    [new ArticleValidationError(
                        "INVALID_INPUT",
                        "body",
                        "Le corps JSON est invalide ou contient un type de valeur inattendu.")]);
            }

            if (parseErrors.Count > 0)
            {
                return Problem(
                    StatusCodes.Status400BadRequest,
                    "La requête est invalide.",
                    "INVALID_INPUT",
                    parseErrors);
            }

            if (command is null)
            {
                return Problem(
                    StatusCodes.Status400BadRequest,
                    "La requête est invalide.",
                    "INVALID_INPUT",
                    [new ArticleValidationError("INVALID_INPUT", "body", "Le corps JSON est requis.")]);
            }

            var result = await useCase.RecordAsync(command, cancellationToken);
            return result.Status switch
            {
                SaleStatus.Committed when result.Receipt is { } receipt
                    => Results.Created(
                        $"/api/sales/{receipt.Operation.Id}",
                        SaleResponse.From(receipt)),
                SaleStatus.ArticleNotFound => Problem(
                    StatusCodes.Status404NotFound,
                    "Article introuvable.",
                    "ARTICLE_NOT_FOUND",
                    result.Errors),
                SaleStatus.ContextRequired => Problem(
                    StatusCodes.Status409Conflict,
                    "Le Contexte de Vente est requis.",
                    "CONTEXT_REQUIRED",
                    result.Errors),
                SaleStatus.ContextIncompatible => Problem(
                    StatusCodes.Status409Conflict,
                    "Le Contexte de Vente est incompatible.",
                    "CONTEXT_INCOMPATIBLE",
                    result.Errors),
                SaleStatus.ContextNotAllowed => Problem(
                    StatusCodes.Status409Conflict,
                    "Le Contexte de Vente n’est pas autorisé.",
                    "CONTEXT_NOT_ALLOWED",
                    result.Errors),
                SaleStatus.NotSellable => Problem(
                    StatusCodes.Status409Conflict,
                    "L’Article ne peut pas être vendu.",
                    "NOT_SELLABLE",
                    result.Errors),
                SaleStatus.OutOfStock => Problem(
                    StatusCodes.Status409Conflict,
                    "Le Stock vendable est insuffisant.",
                    "OUT_OF_STOCK",
                    result.Errors),
                SaleStatus.Conflict => Problem(
                    StatusCodes.Status409Conflict,
                    "La position Stock a changé.",
                    "POSITION_CONFLICT",
                    result.Errors),
                SaleStatus.PersistenceFailed => Problem(
                    StatusCodes.Status500InternalServerError,
                    "La Vente n’a pas pu être enregistrée.",
                    "INTERNAL_ERROR",
                    []),
                _ => Problem(
                    StatusCodes.Status400BadRequest,
                    "La requête est invalide.",
                    "INVALID_INPUT",
                    result.Errors)
            };
        });

        app.MapGet("/api/sales/{operationId}", async (
            string operationId,
            ISaleContract useCase,
            CancellationToken cancellationToken) =>
        {
            var result = await useCase.GetAsync(operationId, cancellationToken);
            return result.Status switch
            {
                SaleStatus.Committed when result.Receipt is { } receipt
                    => Results.Ok(SaleResponse.From(receipt)),
                SaleStatus.SaleNotFound => Problem(
                    StatusCodes.Status404NotFound,
                    "Vente introuvable.",
                    "SALE_NOT_FOUND",
                    result.Errors),
                _ => Problem(
                    StatusCodes.Status500InternalServerError,
                    "La Vente n’a pas pu être relue.",
                    "INTERNAL_ERROR",
                    [])
            };
        });
    }

    private static async Task<(SaleCommand? Command, IReadOnlyList<ArticleValidationError> Errors)> ParseCommandAsync(
        HttpRequest request,
        CancellationToken cancellationToken)
    {
        using var document = await JsonDocument.ParseAsync(request.Body, cancellationToken: cancellationToken);
        if (document.RootElement.ValueKind != JsonValueKind.Object)
        {
            return (null, [new("INVALID_INPUT", "body", "Le corps JSON doit être un objet.")]);
        }

        string? ean13 = null;
        int? quantity = null;
        string? context = null;
        var contextProvided = false;
        var unsupportedFields = new List<string>();
        var errors = new List<ArticleValidationError>();
        var seenFields = new HashSet<string>(StringComparer.Ordinal);

        foreach (var property in document.RootElement.EnumerateObject())
        {
            if (!seenFields.Add(property.Name))
            {
                errors.Add(new(
                    "INVALID_INPUT",
                    property.Name,
                    "Un champ ne peut pas être répété dans la commande."));
                continue;
            }

            switch (property.Name)
            {
                case "ean13":
                    if (property.Value.ValueKind == JsonValueKind.String)
                    {
                        ean13 = property.Value.GetString();
                    }
                    else if (property.Value.ValueKind is not JsonValueKind.Null)
                    {
                        errors.Add(new("INVALID_INPUT", "ean13", "L’EAN-13 doit être une chaîne."));
                    }

                    break;
                case "quantity":
                    if (property.Value.ValueKind == JsonValueKind.Number
                        && !property.Value.GetRawText().Any(character => character is '.' or 'e' or 'E')
                        && property.Value.TryGetInt32(out var parsedQuantity))
                    {
                        quantity = parsedQuantity;
                    }
                    else if (property.Value.ValueKind is not JsonValueKind.Null)
                    {
                        errors.Add(new("INVALID_INPUT", "quantity", "La quantité doit être un entier."));
                    }

                    break;
                case "context":
                    if (property.Value.ValueKind == JsonValueKind.String)
                    {
                        context = property.Value.GetString();
                        contextProvided = context is not null;
                    }
                    else if (property.Value.ValueKind is not JsonValueKind.Null)
                    {
                        errors.Add(new("INVALID_INPUT", "context", "Le Contexte de Vente doit être une chaîne."));
                    }

                    break;
                default:
                    unsupportedFields.Add(property.Name);
                    break;
            }
        }

        return (
            new SaleCommand
            {
                Ean13 = ean13,
                Quantity = quantity,
                Context = context,
                ContextProvided = contextProvided,
                UnsupportedFields = unsupportedFields
            },
            errors);
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

public sealed class SaleResponse
{
    public SaleOperationResponse Operation { get; init; } = new();

    public SaleFinancialResponse Financial { get; init; } = new();

    public StockPositionResponse Position { get; init; } = new();

    public static SaleResponse From(SaleReceipt receipt) => new()
    {
        Operation = SaleOperationResponse.From(receipt.Operation),
        Financial = SaleFinancialResponse.From(receipt.Financial),
        Position = StockPositionResponse.From(receipt.Position)
    };
}

public sealed class SaleOperationResponse
{
    public string Id { get; init; } = string.Empty;

    public string Type { get; init; } = string.Empty;

    public string Ean13 { get; init; } = string.Empty;

    public int Quantity { get; init; }

    public DateTimeOffset OccurredAt { get; init; }

    public static SaleOperationResponse From(StockOperation operation) => new()
    {
        Id = operation.Id,
        Type = "SALE",
        Ean13 = operation.Ean13.Value,
        Quantity = operation.Quantity.Value,
        OccurredAt = operation.OccurredAt
    };
}

public sealed class SaleFinancialResponse
{
    public string? Context { get; init; }

    public int UnitPriceHtCents { get; init; }

    public TaxRateResponse TaxRate { get; init; } = new();

    public int AmountHtCents { get; init; }

    public int VatCents { get; init; }

    public int AmountTtcCents { get; init; }

    public static SaleFinancialResponse From(SaleFinancialSnapshot financial) => new()
    {
        Context = financial.SaleContext switch
        {
            SaleContext.Takeaway => "takeaway",
            SaleContext.OnSite => "onsite",
            _ => null
        },
        UnitPriceHtCents = financial.UnitPriceHt.Cents,
        TaxRate = TaxRateResponse.From(financial.TaxRate),
        AmountHtCents = financial.AmountHt.Cents,
        VatCents = financial.Vat.Cents,
        AmountTtcCents = financial.AmountTtc.Cents
    };
}

public sealed class SaleArticleResponse
{
    public string Ean13 { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    public string Type { get; init; } = string.Empty;

    public bool IsActive { get; init; }

    public string Status { get; init; } = string.Empty;

    public int PriceHtCents { get; init; }

    public int PhysicalQuantity { get; init; }

    public int SellableQuantity { get; init; }

    public string Availability { get; init; } = string.Empty;

    public IReadOnlyList<PriceQuoteResponse> PriceQuotes { get; init; } = [];

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Reason { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Dlc { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<string>? ConsumptionModes { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Packaging { get; init; }

    public static SaleArticleResponse From(SaleArticleView article) => new()
    {
        Ean13 = article.Ean13.Value,
        Name = article.Name,
        Type = article.Type == ArticleType.Food ? "food" : "nonFood",
        IsActive = article.IsActive,
        Status = article.IsActive ? "active" : "archived",
        PriceHtCents = article.PriceHt.Cents,
        PhysicalQuantity = article.PhysicalQuantity,
        SellableQuantity = article.SellableQuantity,
        PriceQuotes = article.PriceQuotes.Select(PriceQuoteResponse.From).ToArray(),
        Availability = article.Availability switch
        {
            StockAvailability.Available => "AVAILABLE",
            StockAvailability.OutOfStock => "OUT_OF_STOCK",
            _ => "NOT_SELLABLE"
        },
        Reason = article.Reason switch
        {
            SellabilityReason.Archived => "ARCHIVED",
            SellabilityReason.DlcExpired => "DLC_EXPIRED",
            SellabilityReason.UnsellablePackaging => "UNSELLABLE_PACKAGING",
            _ => null
        },
        Dlc = article.Type == ArticleType.Food
            ? article.Dlc?.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture)
            : null,
        ConsumptionModes = article.Type == ArticleType.Food
            ? article.ConsumptionModes.Select(mode => mode == ConsumptionMode.Takeaway ? "takeaway" : "onsite").ToArray()
            : null,
        Packaging = article.Type == ArticleType.NonFood && article.Packaging is { } packaging
            ? packaging switch
            {
                PackagingCondition.New => "new",
                PackagingCondition.Refurbished => "refurbished",
                _ => "unsellable"
            }
            : null
    };
}
