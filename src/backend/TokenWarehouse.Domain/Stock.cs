namespace TokenWarehouse.Domain;

public sealed record StockPosition
{
    public StockPosition(Ean13 ean13, int physicalQuantity, int version = 0)
    {
        if (physicalQuantity < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(physicalQuantity));
        }

        if (version < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(version));
        }

        Ean13 = ean13;
        PhysicalQuantity = physicalQuantity;
        Version = version;
    }

    public Ean13 Ean13 { get; }

    public int PhysicalQuantity { get; }

    public int Version { get; }

}

public enum StockAvailability
{
    Available,
    OutOfStock,
    NotSellable
}

public enum SellabilityReason
{
    Archived,
    DlcExpired,
    UnsellablePackaging
}

public sealed record ArticleSellabilitySnapshot(
    Ean13 Ean13,
    string Name,
    ArticleType Type,
    bool IsActive,
    DateOnly? Dlc,
    IReadOnlyList<ConsumptionMode> ConsumptionModes,
    PackagingCondition? Packaging)
{
    public static ArticleSellabilitySnapshot From(Article article)
    {
        ArgumentNullException.ThrowIfNull(article);

        return new(
            article.Ean13,
            article.Name,
            article.Type,
            article.IsActive,
            article.Dlc,
            article.ConsumptionModes,
            article.Packaging);
    }
}

public sealed record SellabilityDecision(
    int SellableQuantity,
    StockAvailability Availability,
    SellabilityReason? Reason);

public static class SellabilityPolicy
{
    public static int Calculate(Article article, StockPosition? position, DateOnly warehouseDate)
        => Calculate(article, position?.PhysicalQuantity ?? 0, warehouseDate);

    public static int Calculate(Article article, int physicalQuantity, DateOnly warehouseDate)
        => Decide(article, physicalQuantity, warehouseDate).SellableQuantity;

    public static SellabilityDecision Decide(Article article, int physicalQuantity, DateOnly warehouseDate)
    {
        ArgumentNullException.ThrowIfNull(article);
        return Decide(ArticleSellabilitySnapshot.From(article), physicalQuantity, warehouseDate);
    }

    public static SellabilityDecision Decide(
        ArticleSellabilitySnapshot article,
        int physicalQuantity,
        DateOnly warehouseDate)
    {
        ArgumentNullException.ThrowIfNull(article);
        ArgumentOutOfRangeException.ThrowIfNegative(physicalQuantity);

        if (physicalQuantity == 0)
        {
            return new(0, StockAvailability.OutOfStock, null);
        }

        if (!article.IsActive)
        {
            return new(0, StockAvailability.NotSellable, SellabilityReason.Archived);
        }

        if (article.Type == ArticleType.Food && article.Dlc is { } dlc && warehouseDate > dlc)
        {
            return new(0, StockAvailability.NotSellable, SellabilityReason.DlcExpired);
        }

        if (article.Type == ArticleType.NonFood && article.Packaging == PackagingCondition.Unsellable)
        {
            return new(0, StockAvailability.NotSellable, SellabilityReason.UnsellablePackaging);
        }

        return new(physicalQuantity, StockAvailability.Available, null);
    }
}
