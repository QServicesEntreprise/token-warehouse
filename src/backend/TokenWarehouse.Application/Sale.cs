using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Application;

public sealed record ArticleSaleSnapshot(
    Ean13 Ean13,
    string Name,
    ArticleType Type,
    bool IsActive,
    DateOnly? Dlc,
    IReadOnlyList<ConsumptionMode> ConsumptionModes,
    PackagingCondition? Packaging,
    Money PriceHt)
{
    internal static ArticleSaleSnapshot From(Article article)
    {
        ArgumentNullException.ThrowIfNull(article);
        return new(
            article.Ean13,
            article.Name,
            article.Type,
            article.IsActive,
            article.Dlc,
            article.ConsumptionModes,
            article.Packaging,
            article.PriceHt);
    }

    internal Article ToPricingArticle()
        => Article.Reconstitute(new ArticleDraft
        {
            Ean13 = Ean13.Value,
            Type = Type == ArticleType.Food ? "food" : "nonFood",
            Name = Name,
            PriceHtCents = PriceHt.Cents,
            Dlc = Dlc?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            DlcProvided = Dlc is not null,
            ConsumptionModes = Type == ArticleType.Food
                ? ConsumptionModes
                    .Select(mode => mode == ConsumptionMode.Takeaway ? "takeaway" : "onsite")
                    .ToArray()
                : null,
            ConsumptionModesProvided = Type == ArticleType.Food,
            Packaging = Packaging switch
            {
                PackagingCondition.New => "new",
                PackagingCondition.Refurbished => "refurbished",
                PackagingCondition.Unsellable => "unsellable",
                _ => null
            },
            PackagingProvided = Type == ArticleType.NonFood
        }, IsActive).Value
        ?? throw new InvalidOperationException("The stored Article sale snapshot is invalid.");

    internal ArticleSellabilitySnapshot ToSellabilitySnapshot()
        => new(Ean13, Name, Type, IsActive, Dlc, ConsumptionModes, Packaging);
}

public interface IArticleSaleReader
{
    ValueTask<ArticleSaleSnapshot?> FindByEanAsync(
        Ean13 ean13,
        CancellationToken cancellationToken = default);

    ValueTask<IReadOnlyList<ArticleSaleSnapshot>> SearchAsync(
        string? search,
        CancellationToken cancellationToken = default);
}

public sealed class ArticleSaleReader(IArticleStore store) : IArticleSaleReader
{
    public async ValueTask<ArticleSaleSnapshot?> FindByEanAsync(
        Ean13 ean13,
        CancellationToken cancellationToken = default)
        => (await store.FindByEanAsync(ean13, cancellationToken)) is { } article
            ? ArticleSaleSnapshot.From(article)
            : null;

    public async ValueTask<IReadOnlyList<ArticleSaleSnapshot>> SearchAsync(
        string? search,
        CancellationToken cancellationToken = default)
        => (await store.ListAsync(
                new ArticleListFilter(
                    ArticleLifecycleFilter.Active,
                    string.IsNullOrWhiteSpace(search) ? null : search.Trim(),
                    null,
                    null,
                    null),
                cancellationToken))
            .Select(ArticleSaleSnapshot.From)
            .ToArray();
}

public sealed record SaleCommand
{
    public string? Ean13 { get; init; }

    public int? Quantity { get; init; }

    public string? Context { get; init; }

    public bool ContextProvided { get; init; }

    public IReadOnlyList<string> UnsupportedFields { get; init; } = [];
}

public sealed record SaleArticleView(
    Ean13 Ean13,
    string Name,
    ArticleType Type,
    bool IsActive,
    DateOnly? Dlc,
    IReadOnlyList<ConsumptionMode> ConsumptionModes,
    PackagingCondition? Packaging,
    Money PriceHt,
    int PhysicalQuantity,
    int SellableQuantity,
    StockAvailability Availability,
    SellabilityReason? Reason);

public enum SaleArticleSearchStatus
{
    Success,
    PersistenceFailed
}

public sealed record SaleArticleSearchResult(
    SaleArticleSearchStatus Status,
    IReadOnlyList<SaleArticleView> Articles,
    IReadOnlyList<ArticleValidationError> Errors);

public enum SaleStatus
{
    Committed,
    ValidationFailed,
    ArticleNotFound,
    ContextUnsupported,
    NotSellable,
    OutOfStock,
    Conflict,
    SaleNotFound,
    PersistenceFailed
}

public sealed record SaleReceipt(
    StockOperation Operation,
    SaleFinancialSnapshot Financial,
    StockPositionView Position);

public sealed record SaleResult(
    SaleStatus Status,
    SaleReceipt? Receipt,
    IReadOnlyList<ArticleValidationError> Errors);

public sealed record SaleReadRecord(
    StockOperation Operation,
    SaleFinancialSnapshot Financial,
    ArticleSellabilitySnapshot Article,
    StockPosition? Position);

public interface ISaleReader
{
    ValueTask<SaleReadRecord?> FindByOperationIdAsync(
        string operationId,
        CancellationToken cancellationToken = default);
}

public interface ISaleContract
{
    Task<SaleArticleSearchResult> SearchArticlesAsync(
        string? search,
        CancellationToken cancellationToken = default);

    Task<SaleResult> RecordAsync(
        SaleCommand command,
        CancellationToken cancellationToken = default);

    Task<SaleResult> GetAsync(
        string operationId,
        CancellationToken cancellationToken = default);
}

public sealed class SaleApplication(
    IArticleSaleReader articleReader,
    IStockSaleContract stockSale,
    ISaleReader saleReader,
    IClock clock,
    IStockPositionReader? positionReader = null) : ISaleContract
{
    private IStockPositionReader PositionReader { get; } = positionReader ?? EmptyPositionReader.Instance;

    public async Task<SaleArticleSearchResult> SearchArticlesAsync(
        string? search,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var articles = await articleReader.SearchAsync(search, cancellationToken);
            var positions = await PositionReader.FindByEansAsync(
                articles.Select(article => article.Ean13).ToArray(),
                cancellationToken);
            var positionsByEan = positions.ToDictionary(position => position.Ean13);

            return new(
                SaleArticleSearchStatus.Success,
                articles.Select(article =>
                {
                    var stock = StockPositionView.From(
                        article.ToSellabilitySnapshot(),
                        positionsByEan.GetValueOrDefault(article.Ean13),
                        clock.WarehouseDate);
                    return new SaleArticleView(
                        article.Ean13,
                        article.Name,
                        article.Type,
                        article.IsActive,
                        article.Dlc,
                        article.ConsumptionModes,
                        article.Packaging,
                        article.PriceHt,
                        stock.PhysicalQuantity,
                        stock.SellableQuantity,
                        stock.Availability,
                        stock.Reason);
                }).ToArray(),
                []);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return new(SaleArticleSearchStatus.PersistenceFailed, [], []);
        }
    }

    public async Task<SaleResult> RecordAsync(
        SaleCommand command,
        CancellationToken cancellationToken = default)
    {
        if (!TryParse(command, out var ean13, out var quantity, out var errors))
        {
            return new(SaleStatus.ValidationFailed, null, errors);
        }

        if (command.ContextProvided)
        {
            return Failure(
                SaleStatus.ContextUnsupported,
                "CONTEXT_UNSUPPORTED",
                "Le Contexte de Vente n’est pas pris en charge par cette tranche.",
                "context");
        }

        try
        {
            var article = await articleReader.FindByEanAsync(ean13, cancellationToken);
            if (article is null)
            {
                return Failure(
                    SaleStatus.ArticleNotFound,
                    "ARTICLE_NOT_FOUND",
                    "L’Article demandé est introuvable.",
                    "ean13");
            }

            if (article.Type != ArticleType.NonFood)
            {
                return Failure(
                    SaleStatus.ContextUnsupported,
                    "CONTEXT_UNSUPPORTED",
                    "Un Article alimentaire nécessite un Contexte de Vente hors de cette tranche.",
                    "context");
            }

            var pricing = PricingPolicy.CalculateSale(article.ToPricingArticle(), quantity);
            if (!pricing.IsSuccess)
            {
                return new(
                    SaleStatus.ValidationFailed,
                    null,
                    pricing.Errors
                        .Select(error => new ArticleValidationError(error.Code, error.Field, error.Message))
                        .ToArray());
            }

            var financial = pricing.Snapshot!;
            var participant = new FinancialParticipant(financial);
            var stockResult = await stockSale.RecordAsync(
                new StockSaleCommand
                {
                    Ean13 = ean13.Value,
                    Quantity = quantity.Value
                },
                participant,
                cancellationToken);
            return stockResult.Status switch
            {
                StockSaleStatus.Committed
                    when stockResult.Receipt is { } stockReceipt
                    => new(
                        SaleStatus.Committed,
                        new(
                            stockReceipt.Operation,
                            financial,
                            stockReceipt.Position),
                        []),
                StockSaleStatus.ArticleNotFound => Failure(
                    SaleStatus.ArticleNotFound,
                    "ARTICLE_NOT_FOUND",
                    "L’Article demandé est introuvable.",
                    "ean13"),
                StockSaleStatus.NotSellable => Failure(
                    SaleStatus.NotSellable,
                    "NOT_SELLABLE",
                    stockResult.Errors.FirstOrDefault()?.Message
                        ?? "L’Article ne peut pas être vendu.",
                    "ean13"),
                StockSaleStatus.OutOfStock => Failure(
                    SaleStatus.OutOfStock,
                    "OUT_OF_STOCK",
                    "La quantité demandée dépasse le Stock vendable courant.",
                    "quantity"),
                StockSaleStatus.Conflict => Failure(
                    SaleStatus.Conflict,
                    "POSITION_CONFLICT",
                    "La position Stock a changé pendant la Vente.",
                    "ean13"),
                _ => Failure(
                    SaleStatus.PersistenceFailed,
                    "PERSISTENCE_FAILURE",
                    "La Vente n’a pas pu être enregistrée.",
                    "ean13")
            };
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return Failure(
                SaleStatus.PersistenceFailed,
                "PERSISTENCE_FAILURE",
                "La Vente n’a pas pu être enregistrée.",
                "ean13");
        }
    }

    public async Task<SaleResult> GetAsync(
        string operationId,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(operationId))
        {
            return Failure(
                SaleStatus.SaleNotFound,
                "SALE_NOT_FOUND",
                "La Vente demandée est introuvable.",
                "operationId");
        }

        try
        {
            var stored = await saleReader.FindByOperationIdAsync(operationId, cancellationToken);
            if (stored is null)
            {
                return Failure(
                    SaleStatus.SaleNotFound,
                    "SALE_NOT_FOUND",
                    "La Vente demandée est introuvable.",
                    "operationId");
            }

            return stored.Position is null
                ? Failure(
                    SaleStatus.PersistenceFailed,
                    "PERSISTENCE_FAILURE",
                    "La Vente engagée ne possède plus sa position Stock.",
                    "operationId")
                : new(
                    SaleStatus.Committed,
                    new(
                        stored.Operation,
                        stored.Financial,
                        StockPositionView.From(
                            stored.Article,
                            stored.Position,
                            clock.WarehouseDate)),
                    []);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return Failure(
                SaleStatus.PersistenceFailed,
                "PERSISTENCE_FAILURE",
                "La Vente n’a pas pu être relue.",
                "operationId");
        }
    }

    private static bool TryParse(
        SaleCommand? command,
        out Ean13 ean13,
        out Quantity quantity,
        out IReadOnlyList<ArticleValidationError> errors)
    {
        var validationErrors = command?.UnsupportedFields
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(field => new ArticleValidationError(
                "INVALID_INPUT",
                field,
                $"Le champ « {field} » n’est pas accepté pour une Vente."))
            .ToList() ?? [];

        if (!Ean13.TryCreate(command?.Ean13, out ean13))
        {
            validationErrors.Add(new(
                "INVALID_INPUT",
                "ean13",
                "L’EAN-13 doit contenir 13 chiffres et un checksum valide."));
        }

        if (!Quantity.TryCreatePositive(command?.Quantity, out quantity))
        {
            validationErrors.Add(new(
                "INVALID_INPUT",
                "quantity",
                "La quantité doit être un entier strictement positif."));
        }

        errors = validationErrors;
        return errors.Count == 0;
    }

    private static SaleResult Failure(
        SaleStatus status,
        string code,
        string message,
        string field)
        => new(status, null, [new(code, field, message)]);

    private sealed class FinancialParticipant(SaleFinancialSnapshot snapshot)
        : IStockSaleCommitParticipant
    {
        public ValueTask PrepareAsync(
            IStockSaleTransaction transaction,
            StockOperation operation,
            CancellationToken cancellationToken = default)
            => transaction.StageAsync(
                new StockSaleCommitData(
                    SaleFinancialSnapshotSerializer.Type,
                    SaleFinancialSnapshotSerializer.Serialize(snapshot)),
                cancellationToken);
    }

    private sealed class EmptyPositionReader : IStockPositionReader
    {
        public static readonly EmptyPositionReader Instance = new();

        public ValueTask<IReadOnlyList<StockPosition>> ListAsync(
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult<IReadOnlyList<StockPosition>>([]);

        public ValueTask<StockPosition?> FindByEanAsync(
            Ean13 ean13,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult<StockPosition?>(null);
    }
}

public sealed record SaleFinancialSnapshotPayload(
    [property: JsonPropertyName("saleContext")] string? SaleContext,
    [property: JsonPropertyName("unitPriceHtCents")] int UnitPriceHtCents,
    [property: JsonPropertyName("taxRateCode")] string TaxRateCode,
    [property: JsonPropertyName("taxRateNumerator")] int TaxRateNumerator,
    [property: JsonPropertyName("taxRateDenominator")] int TaxRateDenominator,
    [property: JsonPropertyName("amountHtCents")] int AmountHtCents,
    [property: JsonPropertyName("vatCents")] int VatCents,
    [property: JsonPropertyName("amountTtcCents")] int AmountTtcCents);

public static class SaleFinancialSnapshotSerializer
{
    public const string Type = "sale.financial.v1";

    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        NumberHandling = JsonNumberHandling.Strict
    };

    public static string Serialize(SaleFinancialSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        return JsonSerializer.Serialize(
            new SaleFinancialSnapshotPayload(
                snapshot.SaleContext switch
                {
                    SaleContext.Takeaway => "takeaway",
                    SaleContext.OnSite => "onsite",
                    _ => null
                },
                snapshot.UnitPriceHt.Cents,
                snapshot.TaxRate.Code,
                snapshot.TaxRate.Numerator,
                snapshot.TaxRate.Denominator,
                snapshot.AmountHt.Cents,
                snapshot.Vat.Cents,
                snapshot.AmountTtc.Cents),
            Options);
    }

    public static bool TryDeserialize(
        string? type,
        string? payload,
        out SaleFinancialSnapshot snapshot)
    {
        snapshot = default!;
        if (!string.Equals(type, Type, StringComparison.Ordinal)
            || string.IsNullOrWhiteSpace(payload))
        {
            return false;
        }

        try
        {
            var data = JsonSerializer.Deserialize<SaleFinancialSnapshotPayload>(payload, Options);
            if (data is null
                || (data.SaleContext is not null
                    && data.SaleContext is not ("takeaway" or "onsite")))
            {
                return false;
            }

            snapshot = new(
                data.SaleContext switch
                {
                    "takeaway" => SaleContext.Takeaway,
                    "onsite" => SaleContext.OnSite,
                    _ => null
                },
                Money.FromCents(data.UnitPriceHtCents),
                new TaxRate(
                    data.TaxRateCode,
                    data.TaxRateNumerator,
                    data.TaxRateDenominator),
                Money.FromCents(data.AmountHtCents),
                Money.FromCents(data.VatCents),
                Money.FromCents(data.AmountTtcCents));
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }
}
