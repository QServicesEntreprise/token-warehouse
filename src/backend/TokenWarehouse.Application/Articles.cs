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

public enum ArticleStoreInsertStatus
{
    Created,
    Conflict
}

public interface IArticleStore
{
    ValueTask<Article?> FindByEanAsync(Ean13 ean13, CancellationToken cancellationToken = default);

    ValueTask<ArticleStoreInsertStatus> InsertAsync(Article article, CancellationToken cancellationToken = default);
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

public sealed class ArticleApplication(IArticleStore store) : ICreateArticleUseCase, IGetArticleUseCase
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
            article.Packaging);
}
