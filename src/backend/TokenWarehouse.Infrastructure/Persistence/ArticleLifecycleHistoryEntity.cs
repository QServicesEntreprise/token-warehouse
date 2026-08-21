namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class ArticleLifecycleHistoryEntity
{
    public long Id { get; set; }

    public string Ean13 { get; set; } = string.Empty;

    public string PreviousStatus { get; set; } = string.Empty;

    public string NextStatus { get; set; } = string.Empty;

    public string OccurredAt { get; set; } = string.Empty;

    public string Kind { get; set; } = "lifecycle";

    public string? ChangesJson { get; set; }
}
