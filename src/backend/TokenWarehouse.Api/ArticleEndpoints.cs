using System.Text.Json;
using System.Text.Json.Serialization;
using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Api;

public static class ArticleEndpoints
{
    public static void MapArticleEndpoints(this WebApplication app)
    {
        app.MapPost("/api/articles", async (
            HttpRequest request,
            ICreateArticleUseCase useCase,
            CancellationToken cancellationToken) =>
        {
            if (!IsJson(request.ContentType))
            {
                return ValidationProblem([
                    new ArticleValidationError(
                        "article.request.content_type",
                        "body",
                        "Le corps doit utiliser le Content-Type application/json.")]);
            }

            CreateArticleRequest? payload;
            try
            {
                payload = await request.ReadFromJsonAsync<CreateArticleRequest>(cancellationToken);
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
                        "article.request.required",
                        "body",
                        "Le corps JSON est requis.")]);
            }

            var result = await useCase.CreateAsync(payload.ToCommand(), cancellationToken);
            return result.Status switch
            {
                ArticleCreateStatus.Created => Results.Created(
                    $"/api/articles/{result.Article!.Ean13}",
                    ArticleResponse.From(result.Article)),
                ArticleCreateStatus.Conflict => ConflictProblem(result.Errors),
                _ => ValidationProblem(result.Errors)
            };
        });

        app.MapGet("/api/articles", async (
            string? status,
            string? search,
            string? type,
            string? mode,
            string? packaging,
            IListArticlesUseCase useCase,
            CancellationToken cancellationToken) =>
        {
            var result = await useCase.ListAsync(new ArticleListQuery
            {
                Status = status,
                Search = search,
                Type = type,
                Mode = mode,
                Packaging = packaging
            }, cancellationToken);

            return result.Status == ArticleListStatus.ValidationFailed
                ? ValidationProblem(result.Errors)
                : Results.Ok(result.Articles.Select(ArticleResponse.From).ToArray());
        });

        app.MapPatch("/api/articles/{ean13}", async (
            string ean13,
            HttpRequest request,
            IUpdateArticlePriceUseCase useCase,
            CancellationToken cancellationToken) =>
        {
            if (!IsJson(request.ContentType))
            {
                return ValidationProblem([
                    new ArticleValidationError(
                        "article.request.content_type",
                        "body",
                        "Le corps doit utiliser le Content-Type application/json.")]);
            }

            UpdateArticlePriceRequest? payload;
            try
            {
                payload = await request.ReadFromJsonAsync<UpdateArticlePriceRequest>(cancellationToken);
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
                        "article.request.required",
                        "body",
                        "Le corps JSON est requis.")]);
            }

            var result = await useCase.UpdatePriceHtAsync(ean13, payload.ToCommand(), cancellationToken);
            return result.Status switch
            {
                ArticleUpdateStatus.Updated => Results.Ok(ArticleResponse.From(result.Article!)),
                ArticleUpdateStatus.NotFound => NotFoundProblem(),
                ArticleUpdateStatus.Conflict => ConflictProblem(
                    result.Errors,
                    "article.priceHt.conflict",
                    "Le Prix HT ne peut pas être modifié."),
                _ => ValidationProblem(result.Errors)
            };
        });

        app.MapGet("/api/articles/{ean13}", async (
            string ean13,
            IGetArticleUseCase useCase,
            CancellationToken cancellationToken) =>
        {
            var result = await useCase.GetAsync(ean13, cancellationToken);
            return result.Status switch
            {
                ArticleReadStatus.Found => Results.Ok(ArticleResponse.From(result.Article!)),
                ArticleReadStatus.NotFound => NotFoundProblem(),
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

    private static IResult ValidationProblem(IReadOnlyList<ArticleValidationError> errors)
        => ArticleProblem(StatusCodes.Status400BadRequest, "La requête est invalide.", "article.validation", errors);

    private static ArticleValidationError InvalidJsonError(JsonException? exception = null)
    {
        var field = exception?.Path?
            .Split('.', StringSplitOptions.RemoveEmptyEntries)
            .LastOrDefault();
        var hasField = !string.IsNullOrWhiteSpace(field) && field != "$";

        return new(
            hasField ? $"article.{field}.invalid" : "article.request.invalid",
            hasField ? field! : "body",
            "Le corps JSON est invalide ou contient un type de valeur inattendu.");
    }

    private static IResult ConflictProblem(
        IReadOnlyList<ArticleValidationError> errors,
        string code = "article.ean13.conflict",
        string title = "L’Article existe déjà.")
        => ArticleProblem(StatusCodes.Status409Conflict, title, code, errors);

    private static IResult ArticleProblem(
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
                ["code"] = "article.not_found"
            });
}

public sealed class CreateArticleRequest
{
    [JsonPropertyName("ean13")]
    public string? Ean13 { get; set; }

    [JsonPropertyName("type")]
    public string? Type { get; set; }

    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("priceHtCents")]
    public int? PriceHtCents { get; set; }

    [JsonPropertyName("dlc")]
    public string? Dlc
    {
        get => dlc;
        set
        {
            dlc = value;
            DlcProvided = true;
        }
    }

    [JsonIgnore]
    public bool DlcProvided { get; private set; }

    [JsonPropertyName("consumptionModes")]
    public List<string>? ConsumptionModes
    {
        get => consumptionModes;
        set
        {
            consumptionModes = value;
            ConsumptionModesProvided = true;
        }
    }

    [JsonIgnore]
    public bool ConsumptionModesProvided { get; private set; }

    [JsonPropertyName("packaging")]
    public string? Packaging
    {
        get => packaging;
        set
        {
            packaging = value;
            PackagingProvided = true;
        }
    }

    [JsonIgnore]
    public bool PackagingProvided { get; private set; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? AdditionalProperties { get; set; }

    public CreateArticleCommand ToCommand() => new()
    {
        Ean13 = Ean13,
        Type = Type,
        Name = Name,
        PriceHtCents = PriceHtCents,
        Dlc = Dlc,
        DlcProvided = DlcProvided,
        ConsumptionModes = ConsumptionModes,
        ConsumptionModesProvided = ConsumptionModesProvided,
        Packaging = Packaging,
        PackagingProvided = PackagingProvided,
        UnsupportedFields = AdditionalProperties?.Keys.ToArray() ?? []
    };

    private string? dlc;
    private List<string>? consumptionModes;
    private string? packaging;
}

public sealed class UpdateArticlePriceRequest
{
    [JsonPropertyName("priceHtCents")]
    public int? PriceHtCents { get; set; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? AdditionalProperties { get; set; }

    public UpdateArticlePriceCommand ToCommand() => new()
    {
        PriceHtCents = PriceHtCents,
        UnsupportedFields = AdditionalProperties?.Keys.ToArray() ?? []
    };
}

public sealed class ArticleResponse
{
    public string Ean13 { get; init; } = string.Empty;
    public string Type { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public int PriceHtCents { get; init; }
    public bool IsActive { get; init; }

    public IReadOnlyList<PriceQuoteResponse> PriceQuotes { get; init; } = [];

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Dlc { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<string>? ConsumptionModes { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Packaging { get; init; }

    public static ArticleResponse From(ArticleView article) => new()
    {
        Ean13 = article.Ean13.Value,
        Type = article.Type == ArticleType.Food ? "food" : "nonFood",
        Name = article.Name,
        PriceHtCents = article.PriceHt.Cents,
        IsActive = article.IsActive,
        PriceQuotes = article.PriceQuotes.Select(PriceQuoteResponse.From).ToArray(),
        Dlc = article.Type == ArticleType.Food
            ? article.Dlc?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            : null,
        ConsumptionModes = article.Type == ArticleType.Food
            ? article.ConsumptionModes.Select(ToWireMode).ToArray()
            : null,
        Packaging = article.Type == ArticleType.NonFood && article.Packaging is not null
            ? ToWirePackaging(article.Packaging.Value)
            : null
    };

    private static string ToWireMode(ConsumptionMode mode)
        => mode == ConsumptionMode.Takeaway ? "takeaway" : "onsite";

    private static string ToWirePackaging(PackagingCondition packaging)
        => packaging switch
        {
            PackagingCondition.New => "new",
            PackagingCondition.Refurbished => "refurbished",
            _ => "unsellable"
        };
}

public sealed class PriceQuoteResponse
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? SaleContext { get; init; }

    public TaxRateResponse TaxRate { get; init; } = new();

    public int VatCents { get; init; }

    public int PriceTtcCents { get; init; }

    public static PriceQuoteResponse From(PricingQuote quote) => new()
    {
        SaleContext = quote.SaleContext switch
        {
            TokenWarehouse.Domain.SaleContext.Takeaway => "takeaway",
            TokenWarehouse.Domain.SaleContext.OnSite => "onsite",
            _ => null
        },
        TaxRate = TaxRateResponse.From(quote.TaxRate),
        VatCents = quote.Vat.Cents,
        PriceTtcCents = quote.PriceTtc.Cents
    };
}

public sealed class TaxRateResponse
{
    public string Code { get; init; } = string.Empty;

    public string Ratio { get; init; } = string.Empty;

    public int Numerator { get; init; }

    public int Denominator { get; init; }

    public static TaxRateResponse From(TaxRate taxRate) => new()
    {
        Code = taxRate.Code,
        Ratio = $"{taxRate.Numerator}/{taxRate.Denominator}",
        Numerator = taxRate.Numerator,
        Denominator = taxRate.Denominator
    };
}
