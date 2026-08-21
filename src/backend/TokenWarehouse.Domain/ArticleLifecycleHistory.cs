namespace TokenWarehouse.Domain;

public sealed record ArticleLifecycleHistory(
    Ean13 Ean13,
    ArticleLifecycleStatus PreviousStatus,
    ArticleLifecycleStatus NextStatus,
    DateTimeOffset OccurredAt);
