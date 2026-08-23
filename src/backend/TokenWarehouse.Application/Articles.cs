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

    public ArticleStockView Stock { get; init; } = new(0, 0);
}

public sealed record ArticleStockView(int PhysicalQuantity, int SellableQuantity);

public interface IStockPositionReader
{
    ValueTask<IReadOnlyList<StockPosition>> ListAsync(
        CancellationToken cancellationToken = default);

    ValueTask<StockPosition?> FindByEanAsync(
        Ean13 ean13,
        CancellationToken cancellationToken = default);

    async ValueTask<IReadOnlyList<StockPosition>> FindByEansAsync(
        IReadOnlyList<Ean13> eans,
        CancellationToken cancellationToken = default)
    {
        var positions = new List<StockPosition>(eans.Count);
        foreach (var ean13 in eans)
        {
            if (await FindByEanAsync(ean13, cancellationToken) is { } position)
            {
                positions.Add(position);
            }
        }

        return positions;
    }
}

public interface IArticleSellabilityReader
{
    ValueTask<ArticleSellabilitySnapshot?> FindSellabilityByEanAsync(
        Ean13 ean13,
        CancellationToken cancellationToken = default);

    async ValueTask<IReadOnlyList<ArticleSellabilitySnapshot>> FindManyAsync(
        IReadOnlyList<Ean13> eans,
        CancellationToken cancellationToken = default)
    {
        var articles = new List<ArticleSellabilitySnapshot>(eans.Count);
        foreach (var ean13 in eans)
        {
            if (await FindSellabilityByEanAsync(ean13, cancellationToken) is { } article)
            {
                articles.Add(article);
            }
        }

        return articles;
    }
}

public interface IArticleSellabilityBatchReader
{
    ValueTask<IReadOnlyDictionary<Ean13, ArticleSellabilitySnapshot>> FindSellabilityByEansAsync(
        IReadOnlyList<Ean13> eans,
        CancellationToken cancellationToken = default);
}

public sealed record ArticleListItemView(
    Ean13 Ean13,
    ArticleType Type,
    string Name,
    Money PriceHt,
    bool IsActive,
    DateOnly? Dlc,
    IReadOnlyList<ConsumptionMode> ConsumptionModes,
    PackagingCondition? Packaging);

public enum ArticleStorePriceUpdateCandidateStatus
{
    Active,
    NotFound,
    Archived
}

public sealed record ArticleStorePriceUpdateCandidate(
    ArticleStorePriceUpdateCandidateStatus Status,
    Article? Article);

public enum ArticleStoreAttributeUpdateStatus
{
    Updated,
    NotFound,
    Conflict
}

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

    ValueTask<ArticleStoreLifecycleTransitionStatus> TransitionLifecycleAsync(
        Ean13 ean13,
        ArticleLifecycleStatus expectedStatus,
        ArticleLifecycleStatus targetStatus,
        ArticleLifecycleHistory history,
        CancellationToken cancellationToken = default);

    ValueTask<IReadOnlyList<ArticleLifecycleHistory>> ListLifecycleHistoryAsync(
        Ean13? ean13 = null,
        CancellationToken cancellationToken = default);

    ValueTask<ArticleStorePriceUpdateCandidate> FindForPriceUpdateAsync(
        Ean13 ean13,
        CancellationToken cancellationToken = default);

    ValueTask<ArticleStoreUpdateStatus> UpdatePriceHtAsync(
        Article article,
        CancellationToken cancellationToken = default);

    ValueTask<ArticleStoreAttributeUpdateStatus> UpdateAttributesAsync(
        Article article,
        ArticleAttributeHistory history,
        CancellationToken cancellationToken = default);

    ValueTask<IReadOnlyList<ArticleAttributeHistory>> ListAttributeHistoryAsync(
        Ean13? ean13 = null,
        CancellationToken cancellationToken = default);
}

public enum ArticleStoreLifecycleTransitionStatus
{
    Updated,
    NotFound,
    Conflict
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

public enum ArticleListStatus
{
    Success,
    ValidationFailed
}

public sealed record ArticleListResult(
    ArticleListStatus Status,
    IReadOnlyList<ArticleListItemView> Articles,
    IReadOnlyList<ArticleValidationError> Errors);

public interface IListArticlesUseCase
{
    Task<ArticleListResult> ListAsync(
        ArticleListQuery query,
        CancellationToken cancellationToken = default);
}

public sealed record UpdateArticlePriceCommand
{
    public int? PriceHtCents { get; init; }

    public IReadOnlyList<string> UnsupportedFields { get; init; } = [];
}

public sealed record UpdateArticleAttributesCommand
{
    public string? Name { get; init; }
    public bool NameProvided { get; init; }
    public string? Dlc { get; init; }
    public bool DlcProvided { get; init; }
    public IReadOnlyList<string>? ConsumptionModes { get; init; }
    public bool ConsumptionModesProvided { get; init; }
    public string? Packaging { get; init; }
    public bool PackagingProvided { get; init; }
    public IReadOnlyList<string> UnsupportedFields { get; init; } = [];

    public ArticleAttributeChanges ToChanges() => new()
    {
        Name = Name,
        NameProvided = NameProvided || Name is not null,
        Dlc = Dlc,
        DlcProvided = DlcProvided || Dlc is not null,
        ConsumptionModes = ConsumptionModes,
        ConsumptionModesProvided = ConsumptionModesProvided || ConsumptionModes is not null,
        Packaging = Packaging,
        PackagingProvided = PackagingProvided || Packaging is not null,
        UnsupportedFields = UnsupportedFields
    };
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

public interface IUpdateArticleAttributesUseCase
{
    Task<ArticleUpdateResult> UpdateAttributesAsync(
        string ean13,
        UpdateArticleAttributesCommand command,
        CancellationToken cancellationToken = default);
}

public sealed class ArticleApplication(IArticleStore store, IClock clock, IStockPositionReader? stockReader = null)
    : ICreateArticleUseCase,
      IGetArticleUseCase,
      IListArticlesUseCase,
      IUpdateArticlePriceUseCase,
      IUpdateArticleAttributesUseCase,
      IChangeArticleLifecycleUseCase,
      IGetArticleHistoryUseCase
{
    private IClock Clock { get; } = clock;

    private IStockPositionReader StockReader { get; } = stockReader ?? EmptyStockPositionReader.Instance;

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
            : new ArticleCreateResult(ArticleCreateStatus.Created, await ToViewAsync(article, cancellationToken), []);
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
            : new ArticleReadResult(ArticleReadStatus.Found, await ToViewAsync(article, cancellationToken), []);
    }

    public async Task<ArticleLifecycleChangeResult> ChangeLifecycleAsync(
        string ean13,
        ArticleLifecycleStatus targetStatus,
        CancellationToken cancellationToken = default)
    {
        var errors = new List<ArticleValidationError>();
        if (!Ean13.TryCreate(ean13, out var parsedEan13))
        {
            errors.Add(new(
                "article.ean13.invalid",
                "ean13",
                "L’EAN-13 doit contenir 13 chiffres et un checksum valide."));
        }

        if (!Enum.IsDefined(typeof(ArticleLifecycleStatus), targetStatus))
        {
            errors.Add(new(
                "article.lifecycle.target.invalid",
                "status",
                "L’état de cycle de vie est inconnu."));
        }

        if (errors.Count > 0)
        {
            return new(ArticleLifecycleChangeStatus.ValidationFailed, null, errors);
        }

        var article = await store.FindByEanAsync(parsedEan13, cancellationToken);
        if (article is null)
        {
            return new(ArticleLifecycleChangeStatus.NotFound, null, []);
        }

        var transition = targetStatus == ArticleLifecycleStatus.Archived
            ? article.Archive()
            : article.Reactivate();
        if (!transition.IsSuccess)
        {
            return new(ArticleLifecycleChangeStatus.Conflict, null, transition.Errors);
        }

        var history = new ArticleLifecycleHistory(
            parsedEan13,
            transition.PreviousStatus,
            transition.CurrentStatus,
            Clock.UtcNow);
        var status = await store.TransitionLifecycleAsync(
            parsedEan13,
            transition.PreviousStatus,
            transition.CurrentStatus,
            history,
            cancellationToken);

        return status switch
        {
            ArticleStoreLifecycleTransitionStatus.Updated
                => new ArticleLifecycleChangeResult(
                    ArticleLifecycleChangeStatus.Updated,
                    await ToViewAsync(article, cancellationToken),
                    []),
            ArticleStoreLifecycleTransitionStatus.NotFound
                => new ArticleLifecycleChangeResult(
                    ArticleLifecycleChangeStatus.NotFound,
                    null,
                    []),
            _ => new ArticleLifecycleChangeResult(
                ArticleLifecycleChangeStatus.Conflict,
                null,
                [LifecycleConflictError(targetStatus)])
        };
    }

    public async Task<ArticleHistoryResult> GetHistoryAsync(
        string? ean13 = null,
        CancellationToken cancellationToken = default)
    {
        Ean13? parsedEan13 = null;
        if (!string.IsNullOrWhiteSpace(ean13))
        {
            if (!Ean13.TryCreate(ean13, out var parsed))
            {
                return new(
                    ArticleHistoryReadStatus.ValidationFailed,
                    [],
                    [new(
                        "article.ean13.invalid",
                        "ean13",
                        "L’EAN-13 doit contenir 13 chiffres et un checksum valide.")]);
            }

            parsedEan13 = parsed;
            if (await store.FindByEanAsync(parsed, cancellationToken) is null)
            {
                return new(ArticleHistoryReadStatus.NotFound, [], []);
            }
        }

        var lifecycleFacts = await store.ListLifecycleHistoryAsync(parsedEan13, cancellationToken);
        var attributeFacts = await store.ListAttributeHistoryAsync(parsedEan13, cancellationToken);
        return new(
            ArticleHistoryReadStatus.Success,
            lifecycleFacts
                .Select(ToHistoryView)
                .Concat(attributeFacts.Select(ToHistoryView))
                .OrderBy(fact => fact.OccurredAt)
                .ToArray(),
            []);
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
            articles.Select(ToListItemView).ToArray(),
            []);
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

        var candidate = await store.FindForPriceUpdateAsync(parsedEan13, cancellationToken);
        if (candidate.Status == ArticleStorePriceUpdateCandidateStatus.NotFound)
        {
            return new ArticleUpdateResult(ArticleUpdateStatus.NotFound, null, []);
        }

        if (candidate.Status == ArticleStorePriceUpdateCandidateStatus.Archived)
        {
            return UpdateConflictResult();
        }

        var article = candidate.Article!;
        var priceError = article.ChangePriceHt(Money.FromCents(command.PriceHtCents!.Value));
        if (priceError is not null)
        {
            return new ArticleUpdateResult(ArticleUpdateStatus.ValidationFailed, null, [priceError]);
        }

        var updateStatus = await store.UpdatePriceHtAsync(article, cancellationToken);
        if (updateStatus == ArticleStoreUpdateStatus.NotFound)
        {
            return new ArticleUpdateResult(ArticleUpdateStatus.NotFound, null, []);
        }

        if (updateStatus == ArticleStoreUpdateStatus.Conflict)
        {
            return UpdateConflictResult();
        }

        return new ArticleUpdateResult(
            ArticleUpdateStatus.Updated,
            await ToViewAsync(article, cancellationToken),
            []);
    }

    public async Task<ArticleUpdateResult> UpdateAttributesAsync(
        string ean13,
        UpdateArticleAttributesCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);

        if (!Ean13.TryCreate(ean13, out var parsedEan13))
        {
            return new ArticleUpdateResult(
                ArticleUpdateStatus.ValidationFailed,
                null,
                [new(
                    "article.ean13.invalid",
                    "ean13",
                    "L’EAN-13 doit contenir 13 chiffres et un checksum valide.")]);
        }

        var article = await store.FindByEanAsync(parsedEan13, cancellationToken);
        if (article is null)
        {
            return new ArticleUpdateResult(ArticleUpdateStatus.NotFound, null, []);
        }

        var update = article.UpdateAttributes(command.ToChanges());
        if (update.Status == ArticleAttributeUpdateStatus.ValidationFailed)
        {
            return new ArticleUpdateResult(ArticleUpdateStatus.ValidationFailed, null, update.Errors);
        }

        if (update.Status == ArticleAttributeUpdateStatus.Conflict)
        {
            return new ArticleUpdateResult(ArticleUpdateStatus.Conflict, null, update.Errors);
        }

        var history = new ArticleAttributeHistory(parsedEan13, update.Changes, Clock.UtcNow);
        var status = await store.UpdateAttributesAsync(article, history, cancellationToken);
        return status switch
        {
            ArticleStoreAttributeUpdateStatus.Updated
                => new ArticleUpdateResult(
                    ArticleUpdateStatus.Updated,
                    await ToViewAsync(article, cancellationToken),
                    []),
            ArticleStoreAttributeUpdateStatus.NotFound
                => new ArticleUpdateResult(ArticleUpdateStatus.NotFound, null, []),
            _ => new ArticleUpdateResult(
                ArticleUpdateStatus.Conflict,
                null,
                [new(
                    "article.update.conflict",
                    "article",
                    "L’Article a changé avant la validation de la modification.")])
        };
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

    private static ArticleUpdateResult UpdateConflictResult()
        => new(
            ArticleUpdateStatus.Conflict,
            null,
            [new(
                "article.priceHt.conflict",
                "priceHtCents",
                "Le Prix HT de cet Article ne peut pas être modifié dans son état courant.")]);

    private static ArticleValidationError LifecycleConflictError(ArticleLifecycleStatus targetStatus)
        => targetStatus == ArticleLifecycleStatus.Archived
            ? new(
                "article.lifecycle.already_archived",
                "status",
                "L’Article ne peut plus être archivé dans son état courant.")
            : new(
                "article.lifecycle.already_active",
                "status",
                "L’Article ne peut plus être réactivé dans son état courant.");

    private static ArticleListItemView ToListItemView(Article article)
        => new(
            article.Ean13,
            article.Type,
            article.Name,
            article.PriceHt,
            article.IsActive,
            article.Dlc,
            article.ConsumptionModes,
            article.Packaging);

    private async Task<ArticleView> ToViewAsync(
        Article article,
        CancellationToken cancellationToken)
    {
        var position = await StockReader.FindByEanAsync(article.Ean13, cancellationToken);
        var physicalQuantity = position?.PhysicalQuantity ?? 0;
        var sellableQuantity = SellabilityPolicy.Calculate(
            article,
            physicalQuantity,
            Clock.WarehouseDate);

        return new(
            article.Ean13,
            article.Type,
            article.Name,
            article.PriceHt,
            article.IsActive,
            article.Dlc,
            article.ConsumptionModes,
            article.Packaging)
        {
            PriceQuotes = PricingPolicy.Calculate(article).Quotes,
            Stock = new ArticleStockView(physicalQuantity, sellableQuantity)
        };
    }

    private static ArticleHistoryView ToHistoryView(ArticleLifecycleHistory history)
        => new(
            history.Ean13,
            history.PreviousStatus,
            history.NextStatus,
            history.OccurredAt,
            []);

    private static ArticleHistoryView ToHistoryView(ArticleAttributeHistory history)
        => new(
            history.Ean13,
            null,
            null,
            history.OccurredAt,
            history.Changes);

    private sealed class EmptyStockPositionReader : IStockPositionReader
    {
        public static readonly EmptyStockPositionReader Instance = new();

        public ValueTask<IReadOnlyList<StockPosition>> ListAsync(
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult<IReadOnlyList<StockPosition>>([]);

        public ValueTask<StockPosition?> FindByEanAsync(
            Ean13 ean13,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult<StockPosition?>(null);
    }
}
