namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class StockPositionEntity
{
    public string Ean13 { get; set; } = string.Empty;

    public int PhysicalQuantity { get; set; }

    public int Version { get; set; }
}
