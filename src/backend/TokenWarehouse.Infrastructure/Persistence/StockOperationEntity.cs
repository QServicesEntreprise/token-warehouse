namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class StockOperationEntity
{
    public string Id { get; set; } = string.Empty;

    public string Type { get; set; } = string.Empty;

    public string Ean13 { get; set; } = string.Empty;

    public int Quantity { get; set; }

    public string OccurredAt { get; set; } = string.Empty;
}
