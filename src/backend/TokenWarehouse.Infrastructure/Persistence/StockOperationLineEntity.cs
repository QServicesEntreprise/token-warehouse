namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class StockOperationLineEntity
{
    public string OperationId { get; set; } = string.Empty;

    public int LineNumber { get; set; }

    public string Ean13 { get; set; } = string.Empty;

    public int Quantity { get; set; }

    public StockOperationEntity? Operation { get; set; }
}
