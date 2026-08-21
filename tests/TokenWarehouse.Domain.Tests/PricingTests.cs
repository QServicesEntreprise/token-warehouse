using TokenWarehouse.Domain;
using Xunit;

namespace TokenWarehouse.Domain.Tests;

public sealed class PricingTests
{
    [Fact]
    public void Calculates_takeaway_tax_and_ttc_in_cents()
    {
        var article = Assert.IsType<Article>(Article.Create(new ArticleDraft
        {
            Ean13 = "0123456789012",
            Type = "food",
            Name = "Chocolat noir",
            PriceHtCents = 1000,
            Dlc = "2026-12-31",
            DlcProvided = true,
            ConsumptionModes = ["takeaway"],
            ConsumptionModesProvided = true
        }).Value);

        var result = PricingPolicy.Calculate(article);

        var quote = Assert.Single(result.Quotes);
        Assert.Equal(SaleContext.Takeaway, quote.SaleContext);
        Assert.Equal(new TaxRate("takeaway", 11, 200), quote.TaxRate);
        Assert.Equal(55, quote.Vat.Cents);
        Assert.Equal(1055, quote.PriceTtc.Cents);
    }

    [Theory]
    [InlineData(99, "food", "takeaway", 5, 104)]
    [InlineData(100, "food", "takeaway", 6, 106)]
    [InlineData(101, "food", "takeaway", 6, 107)]
    [InlineData(5, "food", "onsite", 1, 6)]
    [InlineData(2, "nonFood", "", 0, 2)]
    [InlineData(3, "nonFood", "", 1, 4)]
    public void Rounds_tax_away_from_zero_and_adds_it_to_ht(
        int priceHtCents,
        string type,
        string mode,
        int vatCents,
        int priceTtcCents)
    {
        var article = type == "food"
            ? CreateFood(priceHtCents, mode)
            : CreateNonFood(priceHtCents);

        var quote = Assert.Single(PricingPolicy.Calculate(article).Quotes);

        Assert.Equal(vatCents, quote.Vat.Cents);
        Assert.Equal(priceTtcCents, quote.PriceTtc.Cents);
        Assert.Equal(priceHtCents + vatCents, quote.PriceTtc.Cents);
    }

    [Fact]
    public void Calculates_both_food_quotes_and_requires_context_to_resolve_one()
    {
        var article = CreateFood(1000, "takeaway", "onsite");

        var quotes = PricingPolicy.Calculate(article).Quotes;
        var resolved = PricingPolicy.Resolve(article, SaleContext.OnSite);
        var ambiguous = PricingPolicy.Resolve(article);

        Assert.Equal(
            new SaleContext?[] { SaleContext.Takeaway, SaleContext.OnSite },
            quotes.Select(quote => quote.SaleContext).ToArray());
        Assert.Equal(100, Assert.Single(resolved.Quotes).Vat.Cents);
        Assert.False(ambiguous.IsSuccess);
        Assert.Contains(ambiguous.Errors, error => error.Code == "pricing.saleContext.required");
    }

    [Fact]
    public void Calculates_non_food_at_twenty_percent_without_a_context()
    {
        var result = Article.Create(new ArticleDraft
        {
            Ean13 = "7351353713578",
            Type = "nonFood",
            Name = "Batterie",
            PriceHtCents = 1000,
            Packaging = "new",
            PackagingProvided = true
        });

        var quote = Assert.Single(PricingPolicy.Calculate(Assert.IsType<Article>(result.Value)).Quotes);

        Assert.Null(quote.SaleContext);
        Assert.Equal(new TaxRate("nonFood", 1, 5), quote.TaxRate);
        Assert.Equal(200, quote.Vat.Cents);
        Assert.Equal(1200, quote.PriceTtc.Cents);
    }

    [Fact]
    public void Changes_only_the_reference_ht_price()
    {
        var article = CreateFood(1000, "takeaway", "onsite");

        article.ChangePriceHt(Money.FromCents(199));

        Assert.Equal(199, article.PriceHt.Cents);
        Assert.Equal(210, Assert.Single(PricingPolicy.Resolve(article, SaleContext.Takeaway).Quotes).PriceTtc.Cents);
        Assert.Equal(219, Assert.Single(PricingPolicy.Resolve(article, SaleContext.OnSite).Quotes).PriceTtc.Cents);
    }

    private static Article CreateFood(int priceHtCents, params string[] modes)
        => Assert.IsType<Article>(Article.Create(new ArticleDraft
        {
            Ean13 = "0123456789012",
            Type = "food",
            Name = "Chocolat noir",
            PriceHtCents = priceHtCents,
            Dlc = "2026-12-31",
            DlcProvided = true,
            ConsumptionModes = modes,
            ConsumptionModesProvided = true
        }).Value);

    private static Article CreateNonFood(int priceHtCents)
        => Assert.IsType<Article>(Article.Create(new ArticleDraft
        {
            Ean13 = "7351353713578",
            Type = "nonFood",
            Name = "Batterie",
            PriceHtCents = priceHtCents,
            Packaging = "new",
            PackagingProvided = true
        }).Value);
}
