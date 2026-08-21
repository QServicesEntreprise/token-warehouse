using TokenWarehouse.Domain;
using Xunit;

namespace TokenWarehouse.Domain.Tests;

public sealed class SellabilityTests
{
    [Fact]
    public void Food_is_sellable_on_the_inclusive_dlc_date_and_not_the_next_day()
    {
        var article = CreateFood(new DateOnly(2026, 8, 21));
        var position = new StockPosition(article.Ean13, 12);

        Assert.Equal(12, SellabilityPolicy.Calculate(article, position, new DateOnly(2026, 8, 21)));
        Assert.Equal(0, SellabilityPolicy.Calculate(article, position, new DateOnly(2026, 8, 22)));
        Assert.Equal(12, position.PhysicalQuantity);
    }

    [Fact]
    public void Unsellable_packaging_and_archived_articles_keep_physical_stock_but_have_no_sellable_stock()
    {
        var article = CreateNonFood("unsellable");
        var position = new StockPosition(article.Ean13, 7);

        Assert.Equal(0, SellabilityPolicy.Calculate(article, position, new DateOnly(2026, 8, 21)));
        Assert.Equal(7, position.PhysicalQuantity);

        article.Archive();
        Assert.Equal(0, SellabilityPolicy.Calculate(article, position, new DateOnly(2026, 8, 21)));
    }

    private static Article CreateFood(DateOnly dlc)
        => Assert.IsType<Article>(Article.Create(new ArticleDraft
        {
            Ean13 = "0123456789012",
            Type = "food",
            Name = "Chocolat noir",
            PriceHtCents = 199,
            Dlc = dlc.ToString("yyyy-MM-dd"),
            DlcProvided = true,
            ConsumptionModes = ["takeaway"],
            ConsumptionModesProvided = true
        }).Value);

    private static Article CreateNonFood(string packaging)
        => Assert.IsType<Article>(Article.Create(new ArticleDraft
        {
            Ean13 = "7351353713578",
            Type = "nonFood",
            Name = "Batterie",
            PriceHtCents = 2500,
            Packaging = packaging,
            PackagingProvided = true
        }).Value);
}
