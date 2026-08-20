using System.Text.Json;
using System.Text.Json.Serialization;
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
            catch (Exception exception) when (exception is JsonException or NotSupportedException)
            {
                return ValidationProblem([
                    new ArticleValidationError(
                        "article.request.invalid",
                        "body",
                        "Le corps JSON est invalide ou contient un type de valeur inattendu.")]);
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

    private static IResult ConflictProblem(IReadOnlyList<ArticleValidationError> errors)
        => ArticleProblem(StatusCodes.Status409Conflict, "L’Article existe déjà.", "article.ean13.conflict", errors);

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

public sealed class ArticleResponse
{
    public string Ean13 { get; init; } = string.Empty;
    public string Type { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public int PriceHtCents { get; init; }
    public bool IsActive { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Dlc { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<string>? ConsumptionModes { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Packaging { get; init; }

    public static ArticleResponse From(ArticleView article) => new()
    {
        Ean13 = article.Ean13,
        Type = article.Type,
        Name = article.Name,
        PriceHtCents = article.PriceHtCents,
        IsActive = article.IsActive,
        Dlc = article.Dlc,
        ConsumptionModes = article.ConsumptionModes,
        Packaging = article.Packaging
    };
}
