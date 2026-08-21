using TokenWarehouse.Domain;

namespace TokenWarehouse.Application;

public interface IClock
{
    DateTimeOffset UtcNow { get; }

    DateOnly WarehouseDate => DateOnly.FromDateTime(UtcNow.DateTime);
}

public enum ArticleLifecycleChangeStatus
{
    Updated,
    ValidationFailed,
    NotFound,
    Conflict
}

public sealed record ArticleLifecycleChangeResult(
    ArticleLifecycleChangeStatus Status,
    ArticleView? Article,
    IReadOnlyList<ArticleValidationError> Errors);

public interface IChangeArticleLifecycleUseCase
{
    Task<ArticleLifecycleChangeResult> ChangeLifecycleAsync(
        string ean13,
        ArticleLifecycleStatus targetStatus,
        CancellationToken cancellationToken = default);
}

public sealed record ArticleHistoryView(
    Ean13 Ean13,
    ArticleLifecycleStatus? PreviousStatus,
    ArticleLifecycleStatus? NextStatus,
    DateTimeOffset OccurredAt,
    IReadOnlyList<ArticleAttributeChange> Changes);

public enum ArticleHistoryReadStatus
{
    Success,
    ValidationFailed,
    NotFound
}

public sealed record ArticleHistoryResult(
    ArticleHistoryReadStatus Status,
    IReadOnlyList<ArticleHistoryView> Facts,
    IReadOnlyList<ArticleValidationError> Errors);

public interface IGetArticleHistoryUseCase
{
    Task<ArticleHistoryResult> GetHistoryAsync(
        string? ean13 = null,
        CancellationToken cancellationToken = default);
}
