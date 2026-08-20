using TokenWarehouse.Domain;
using Xunit;

namespace TokenWarehouse.Domain.Tests;

public sealed class ArticleTests
{
    [Fact]
    public void Creates_a_food_article_with_a_zero_prefixed_ean_and_one_mode()
    {
        var result = Article.Create(new ArticleDraft
        {
            Ean13 = "0123456789012",
            Type = "food",
            Name = "Chocolat noir",
            PriceHtCents = 199,
            Dlc = "2026-12-31",
            DlcProvided = true,
            ConsumptionModes = ["takeaway"],
            ConsumptionModesProvided = true
        });

        Assert.True(result.IsSuccess);
        var article = Assert.IsType<Article>(result.Value);
        Assert.Equal("0123456789012", article.Ean13.Value);
        Assert.Equal(199, article.PriceHt.Cents);
        Assert.True(article.IsActive);
        Assert.Equal(ArticleType.Food, article.Type);
        Assert.Equal([ConsumptionMode.Takeaway], article.ConsumptionModes);
        Assert.Equal(new DateOnly(2026, 12, 31), article.Dlc);
        Assert.Null(article.Packaging);
    }

    [Fact]
    public void Rejects_invalid_ean_before_an_article_can_be_created()
    {
        var result = Article.Create(new ArticleDraft
        {
            Ean13 = "0123456789013",
            Type = "food",
            Name = "Chocolat noir",
            PriceHtCents = 199,
            Dlc = "2026-12-31",
            DlcProvided = true,
            ConsumptionModes = ["takeaway"],
            ConsumptionModesProvided = true
        });

        Assert.False(result.IsSuccess);
        Assert.Null(result.Value);
        Assert.Contains(result.Errors, error => error.Code == "article.ean13.invalid" && error.Field == "ean13");
    }

    [Theory]
    [InlineData("takeaway")]
    [InlineData("onsite")]
    [InlineData("takeaway,onsite")]
    public void Creates_each_supported_food_mode_shape(string modes)
    {
        var result = Article.Create(new ArticleDraft
        {
            Ean13 = "4006381333931",
            Type = "food",
            Name = "Café",
            PriceHtCents = -1,
            Dlc = "2026-01-02",
            DlcProvided = true,
            ConsumptionModes = modes.Split(','),
            ConsumptionModesProvided = true
        });

        Assert.True(result.IsSuccess);
        Assert.NotNull(result.Value);
    }

    [Theory]
    [InlineData("new")]
    [InlineData("refurbished")]
    [InlineData("unsellable")]
    public void Creates_each_supported_non_food_packaging(string packaging)
    {
        var result = Article.Create(new ArticleDraft
        {
            Ean13 = "7351353713578",
            Type = "nonFood",
            Name = "Batterie",
            PriceHtCents = 2500,
            Packaging = packaging,
            PackagingProvided = true
        });

        Assert.True(result.IsSuccess);
        var article = Assert.IsType<Article>(result.Value);
        Assert.Null(article.Dlc);
        Assert.Empty(article.ConsumptionModes);
        Assert.NotNull(article.Packaging);
    }

    [Fact]
    public void Rejects_missing_and_cross_classification_fields()
    {
        var result = Article.Create(new ArticleDraft
        {
            Ean13 = "4006381333931",
            Type = "food",
            Name = "Café",
            PriceHtCents = 100,
            Packaging = "new",
            PackagingProvided = true,
            ConsumptionModes = ["takeaway", "takeaway"],
            ConsumptionModesProvided = true
        });

        Assert.False(result.IsSuccess);
        Assert.Contains(result.Errors, error => error.Code == "article.dlc.required");
        Assert.Contains(result.Errors, error => error.Code == "article.packaging.not_applicable");
        Assert.Contains(result.Errors, error => error.Code == "article.consumptionModes.duplicate");
    }
}
