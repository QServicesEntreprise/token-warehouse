namespace TokenWarehouse.Domain;

public sealed record ArticleLifecycleHistory(
    Ean13 Ean13,
    ArticleLifecycleStatus PreviousStatus,
    ArticleLifecycleStatus NextStatus,
    DateTimeOffset OccurredAt);

public sealed record ArticleAttributeHistory(
    Ean13 Ean13,
    IReadOnlyList<ArticleAttributeChange> Changes,
    DateTimeOffset OccurredAt);
