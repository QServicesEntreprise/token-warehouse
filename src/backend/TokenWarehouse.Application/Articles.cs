using TokenWarehouse.Domain;

namespace TokenWarehouse.Application;

public sealed record CreateArticleCommand
{
    public string? Ean13 { get; init; }
    public string? Type { get; init; }
    public string? Name { get; init; }
    public int? PriceHtCents { get; init; }
    public string? Dlc { get; init; }
    public bool DlcProvided { get; init; }
    public IReadOnlyList<string>? ConsumptionModes { get; init; }
    public bool ConsumptionModesProvided { get; init; }
    public string? Packaging { get; init; }
    public bool PackagingProvided { get; init; }
    public IReadOnlyList<string> UnsupportedFields { get; init; } = [];

    public ArticleDraft ToDraft() => new()
    {
        Ean13 = Ean13,
        Type = Type,
        Name = Name,
        PriceHtCents = PriceHtCents,
        Dlc = Dlc,
        DlcProvided = DlcProvided || Dlc is not null,
        ConsumptionModes = ConsumptionModes,
        ConsumptionModesProvided = ConsumptionModesProvided || ConsumptionModes is not null,
        Packaging = Packaging,
        PackagingProvided = PackagingProvided || Packaging is not null,
        UnsupportedFields = UnsupportedFields
    };
}

public sealed record ArticleView(
    Ean13 Ean13,
    ArticleType Type,
    string Name,
    Money PriceHt,
    bool IsActive,
    DateOnly? Dlc,
    IReadOnlyList<ConsumptionMode> ConsumptionModes,
    PackagingCondition? Packaging)
{
    public IReadOnlyList<PricingQuote> PriceQuotes { get; init; } = [];
}

public enum ArticleStoreInsertStatus
{
    Created,
    Conflict
}

public interface IArticleStore
{
    ValueTask<Article?> FindByEanAsync(Ean13 ean13, CancellationToken cancellationToken = default);

    ValueTask<ArticleStoreInsertStatus> InsertAsync(Article article, CancellationToken cancellationToken = default);

    ValueTask<ArticleStoreUpdateStatus> UpdatePriceHtAsync(
        Ean13 ean13,
        Money priceHt,
        CancellationToken cancellationToken = default);
}

public enum ArticleStoreUpdateStatus
{
    Updated,
    NotFound,
    Conflict
}

public enum ArticleCreateStatus
{
    Created,
    ValidationFailed,
    Conflict
}

public sealed record ArticleCreateResult(
    ArticleCreateStatus Status,
    ArticleView? Article,
    IReadOnlyList<ArticleValidationError> Errors);

public interface ICreateArticleUseCase
{
    Task<ArticleCreateResult> CreateAsync(CreateArticleCommand command, CancellationToken cancellationToken = default);
}

public enum ArticleReadStatus
{
    Found,
    ValidationFailed,
    NotFound
}

public sealed record ArticleReadResult(
    ArticleReadStatus Status,
    ArticleView? Article,
    IReadOnlyList<ArticleValidationError> Errors);

public interface IGetArticleUseCase
{
    Task<ArticleReadResult> GetAsync(string ean13, CancellationToken cancellationToken = default);
}

public sealed record UpdateArticlePriceCommand
{
    public int? PriceHtCents { get; init; }

    public IReadOnlyList<string> UnsupportedFields { get; init; } = [];
}

public enum ArticleUpdateStatus
{
    Updated,
    ValidationFailed,
    NotFound,
    Conflict
}

public sealed record ArticleUpdateResult(
    ArticleUpdateStatus Status,
    ArticleView? Article,
    IReadOnlyList<ArticleValidationError> Errors);

public interface IUpdateArticlePriceUseCase
{
    Task<ArticleUpdateResult> UpdatePriceHtAsync(
        string ean13,
        UpdateArticlePriceCommand command,
        CancellationToken cancellationToken = default);
}

public sealed class ArticleApplication(IArticleStore store)
    : ICreateArticleUseCase, IGetArticleUseCase, IUpdateArticlePriceUseCase
{
    public async Task<ArticleCreateResult> CreateAsync(
        CreateArticleCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);

        var creation = Article.Create(command.ToDraft());
        if (!creation.IsSuccess)
        {
            return new ArticleCreateResult(ArticleCreateStatus.ValidationFailed, null, creation.Errors);
        }

        var article = creation.Value!;
        if (await store.FindByEanAsync(article.Ean13, cancellationToken) is not null)
        {
            return ConflictResult();
        }

        var insertStatus = await store.InsertAsync(article, cancellationToken);
        return insertStatus == ArticleStoreInsertStatus.Conflict
            ? ConflictResult()
            : new ArticleCreateResult(ArticleCreateStatus.Created, ToView(article), []);
    }

    public async Task<ArticleReadResult> GetAsync(string ean13, CancellationToken cancellationToken = default)
    {
        if (!Ean13.TryCreate(ean13, out var parsedEan13))
        {
            return new ArticleReadResult(
                ArticleReadStatus.ValidationFailed,
                null,
                [new(
                    "article.ean13.invalid",
                    "ean13",
                    "L’EAN-13 doit contenir 13 chiffres et un checksum valide.")]);
        }

        var article = await store.FindByEanAsync(parsedEan13, cancellationToken);
        return article is null
            ? new ArticleReadResult(ArticleReadStatus.NotFound, null, [])
            : new ArticleReadResult(ArticleReadStatus.Found, ToView(article), []);
    }

    public async Task<ArticleUpdateResult> UpdatePriceHtAsync(
        string ean13,
        UpdateArticlePriceCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);

        var errors = command.UnsupportedFields
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(field => new ArticleValidationError(
                "article.field.unsupported",
                field,
                $"Le champ « {field} » n’est pas accepté pour la mise à jour du Prix HT."))
            .ToList();

        if (!Ean13.TryCreate(ean13, out var parsedEan13))
        {
            errors.Add(new(
                "article.ean13.invalid",
                "ean13",
                "L’EAN-13 doit contenir 13 chiffres et un checksum valide."));
        }

        if (command.PriceHtCents is null)
        {
            errors.Add(new(
                "article.priceHtCents.required",
                "priceHtCents",
                "Le Prix HT en centimes est requis."));
        }

        if (errors.Count > 0)
        {
            return new ArticleUpdateResult(ArticleUpdateStatus.ValidationFailed, null, errors);
        }

        var article = await store.FindByEanAsync(parsedEan13, cancellationToken);
        if (article is null)
        {
            return new ArticleUpdateResult(ArticleUpdateStatus.NotFound, null, []);
        }

        var updateStatus = await store.UpdatePriceHtAsync(
            parsedEan13,
            Money.FromCents(command.PriceHtCents!.Value),
            cancellationToken);
        if (updateStatus == ArticleStoreUpdateStatus.NotFound)
        {
            return new ArticleUpdateResult(ArticleUpdateStatus.NotFound, null, []);
        }

        if (updateStatus == ArticleStoreUpdateStatus.Conflict)
        {
            return new ArticleUpdateResult(
                ArticleUpdateStatus.Conflict,
                null,
                [new(
                    "article.priceHt.conflict",
                    "priceHtCents",
                    "Le Prix HT de cet Article ne peut pas être modifié dans son état courant.")]);
        }

        article.ChangePriceHt(Money.FromCents(command.PriceHtCents.Value));
        return new ArticleUpdateResult(ArticleUpdateStatus.Updated, ToView(article), []);
    }

    private static ArticleCreateResult ConflictResult()
        => new(
            ArticleCreateStatus.Conflict,
            null,
            [new(
                "article.ean13.conflict",
                "ean13",
                "Un Article utilise déjà cet EAN-13.")]);

    private static ArticleView ToView(Article article)
        => new(
            article.Ean13,
            article.Type,
            article.Name,
            article.PriceHt,
            article.IsActive,
            article.Dlc,
            article.ConsumptionModes,
            article.Packaging)
        {
            PriceQuotes = PricingPolicy.Calculate(article).Quotes
        };
}
