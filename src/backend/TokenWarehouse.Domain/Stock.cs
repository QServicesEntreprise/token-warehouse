namespace TokenWarehouse.Domain;

public sealed record StockPosition
{
    public StockPosition(Ean13 ean13, int physicalQuantity)
    {
        if (physicalQuantity < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(physicalQuantity));
        }

        Ean13 = ean13;
        PhysicalQuantity = physicalQuantity;
    }

    public Ean13 Ean13 { get; }

    public int PhysicalQuantity { get; }
}

public static class SellabilityPolicy
{
    public static int Calculate(Article article, StockPosition? position, DateOnly warehouseDate)
        => Calculate(article, position?.PhysicalQuantity ?? 0, warehouseDate);

    public static int Calculate(Article article, int physicalQuantity, DateOnly warehouseDate)
    {
        ArgumentNullException.ThrowIfNull(article);
        ArgumentOutOfRangeException.ThrowIfNegative(physicalQuantity);

        if (!article.IsActive || physicalQuantity == 0)
        {
            return 0;
        }

        return article.Type switch
        {
            ArticleType.Food when article.Dlc is { } dlc => warehouseDate <= dlc ? physicalQuantity : 0,
            ArticleType.NonFood when article.Packaging != PackagingCondition.Unsellable => physicalQuantity,
            _ => 0
        };
    }
}
