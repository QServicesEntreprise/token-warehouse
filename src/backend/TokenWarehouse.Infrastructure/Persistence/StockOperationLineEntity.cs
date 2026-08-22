namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class StockOperationLineEntity
{
    public string OperationId { get; set; } = string.Empty;

    public int LineNumber { get; set; }

    public string Ean13 { get; set; } = string.Empty;

    public string OperationType { get; set; } = "INVENTORY";

    public int Quantity { get; set; }

    public int PreviousPhysicalStock { get; set; }

    public int CountedQuantity { get; set; }

    public int InventoryDifference { get; set; }

    public int ResultingPhysicalStock { get; set; }

    public int SourceEffect { get; set; }

    public int InverseEffect { get; set; }

    public StockOperationEntity? Operation { get; set; }
}
