namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class StockOperationLineEntity
{
    public string OperationId { get; set; } = string.Empty;

    public int LineNumber { get; set; }

    public string Ean13 { get; set; } = string.Empty;

    public int PreviousPhysicalStock { get; set; }

    public int CountedQuantity { get; set; }

    public int InventoryDifference { get; set; }

    public int ResultingPhysicalStock { get; set; }
}
