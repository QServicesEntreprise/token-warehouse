namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class StockOperationEntity
{
    public string Id { get; set; } = string.Empty;

    public string Type { get; set; } = string.Empty;

    public string Ean13 { get; set; } = string.Empty;

    public int Quantity { get; set; }

    public string OccurredAt { get; set; } = string.Empty;

    public int PreviousPhysicalStock { get; set; }

    public int CountedQuantity { get; set; }

    public int InventoryDifference { get; set; }

    public int ResultingPhysicalStock { get; set; }

    public string TimestampUtc { get; set; } = string.Empty;

    public string? SourceOperationId { get; set; }

    public string? SourceOperationType { get; set; }

    public string? Justification { get; set; }

    public string? SaleCommitDataType { get; set; }

    public string? SaleCommitDataPayload { get; set; }

    public ICollection<StockOperationLineEntity> Lines { get; set; } = [];
}
