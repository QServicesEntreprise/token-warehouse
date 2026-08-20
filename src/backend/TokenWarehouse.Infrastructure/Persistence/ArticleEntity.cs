namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class ArticleEntity
{
    public string Ean13 { get; set; } = string.Empty;

    public string Type { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public int PriceHtCents { get; set; }

    public bool IsActive { get; set; }

    public string? Dlc { get; set; }

    public string? ConsumptionModes { get; set; }

    public string? Packaging { get; set; }
}
