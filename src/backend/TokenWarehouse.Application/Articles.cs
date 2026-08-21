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
    PackagingCondition? Packaging);

public sealed record ArticleListQuery
{
    public string? Status { get; init; }
    public string? Search { get; init; }
    public string? Type { get; init; }
    public string? Mode { get; init; }
    public string? Packaging { get; init; }
}

public enum ArticleLifecycleFilter
{
    Active,
    Archived,
    All
}

public sealed record ArticleListFilter(
    ArticleLifecycleFilter Status,
    string? Search,
    ArticleType? Type,
    ConsumptionMode? Mode,
    PackagingCondition? Packaging);

public enum ArticleStoreInsertStatus
{
    Created,
    Conflict
}

public interface IArticleStore
{
    ValueTask<Article?> FindByEanAsync(Ean13 ean13, CancellationToken cancellationToken = default);

    ValueTask<ArticleStoreInsertStatus> InsertAsync(Article article, CancellationToken cancellationToken = default);

    // ponytail: catalogue MVP non paginé; ajouter un curseur seulement sur preuve de volume ou latence.
    ValueTask<IReadOnlyList<Article>> ListAsync(
        ArticleListFilter filter,
        CancellationToken cancellationToken = default);
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

public enum ArticleListStatus
{
    Success,
    ValidationFailed
}

public sealed record ArticleListResult(
    ArticleListStatus Status,
    IReadOnlyList<ArticleView> Articles,
    IReadOnlyList<ArticleValidationError> Errors);

public interface IListArticlesUseCase
{
    Task<ArticleListResult> ListAsync(
        ArticleListQuery query,
        CancellationToken cancellationToken = default);
}

public sealed class ArticleApplication(IArticleStore store) : ICreateArticleUseCase, IGetArticleUseCase, IListArticlesUseCase
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

    public async Task<ArticleListResult> ListAsync(
        ArticleListQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);

        if (!TryParseFilter(query, out var filter, out var errors))
        {
            return new ArticleListResult(ArticleListStatus.ValidationFailed, [], errors);
        }

        var articles = await store.ListAsync(filter, cancellationToken);
        return new ArticleListResult(
            ArticleListStatus.Success,
            articles.Select(ToView).ToArray(),
            []);
    }

    private static ArticleCreateResult ConflictResult()
        => new(
            ArticleCreateStatus.Conflict,
            null,
            [new(
                "article.ean13.conflict",
                "ean13",
                "Un Article utilise déjà cet EAN-13.")]);

    private static bool TryParseFilter(
        ArticleListQuery query,
        out ArticleListFilter filter,
        out IReadOnlyList<ArticleValidationError> errors)
    {
        var validationErrors = new List<ArticleValidationError>();
        var status = ArticleLifecycleFilter.Active;
        ArticleType? type = null;
        ConsumptionMode? mode = null;
        PackagingCondition? packaging = null;

        if (query.Status is not null && !TryParseStatus(query.Status, out status))
        {
            validationErrors.Add(InvalidFilter("status", "La vue de statut est inconnue."));
        }

        if (query.Type is not null && !TryParseTypeFilter(query.Type, out type))
        {
            validationErrors.Add(InvalidFilter("type", "Le type de filtre est inconnu."));
        }

        if (query.Mode is not null)
        {
            if (Article.TryParseConsumptionMode(query.Mode, out var parsedMode))
            {
                mode = parsedMode;
            }
            else
            {
                validationErrors.Add(InvalidFilter("mode", "Le mode de consommation est inconnu."));
            }
        }

        if (query.Packaging is not null)
        {
            if (Article.TryParsePackaging(query.Packaging, out var parsedPackaging))
            {
                packaging = parsedPackaging;
            }
            else
            {
                validationErrors.Add(InvalidFilter("packaging", "La valeur de Packaging est inconnue."));
            }
        }

        if (validationErrors.Count > 0)
        {
            filter = default!;
            errors = validationErrors;
            return false;
        }

        filter = new ArticleListFilter(
            status,
            string.IsNullOrWhiteSpace(query.Search) ? null : query.Search.Trim(),
            type,
            mode,
            packaging);
        errors = [];
        return true;
    }

    private static bool TryParseStatus(string value, out ArticleLifecycleFilter status)
    {
        status = ArticleLifecycleFilter.Active;
        if (value.Equals("active", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (value.Equals("archived", StringComparison.OrdinalIgnoreCase))
        {
            status = ArticleLifecycleFilter.Archived;
            return true;
        }

        if (value.Equals("all", StringComparison.OrdinalIgnoreCase))
        {
            status = ArticleLifecycleFilter.All;
            return true;
        }

        return false;
    }

    private static bool TryParseTypeFilter(string value, out ArticleType? type)
    {
        type = null;
        if (value.Equals("all", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (Article.TryParseArticleType(value, out var parsedType))
        {
            type = parsedType;
            return true;
        }

        return false;
    }

    private static ArticleValidationError InvalidFilter(string field, string message)
        => new($"article.list.{field}.invalid", field, message);

    private static ArticleView ToView(Article article)
        => new(
            article.Ean13,
            article.Type,
            article.Name,
            article.PriceHt,
            article.IsActive,
            article.Dlc,
            article.ConsumptionModes,
            article.Packaging);
}
