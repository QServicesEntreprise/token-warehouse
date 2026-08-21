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

    [Fact]
    public void Keeps_consumption_modes_read_only_after_creation()
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

        var article = Assert.IsType<Article>(result.Value);
        var modes = Assert.IsAssignableFrom<IList<ConsumptionMode>>(article.ConsumptionModes);

        Assert.Throws<NotSupportedException>(() => modes[0] = ConsumptionMode.OnSite);
        Assert.Equal([ConsumptionMode.Takeaway], article.ConsumptionModes);
        Assert.IsNotType<ConsumptionMode[]>(article.ConsumptionModes);
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

    [Fact]
    public void Archives_and_reactivates_an_article_without_changing_its_catalogue_identity()
    {
        var article = Assert.IsType<Article>(Article.Create(new ArticleDraft
        {
            Ean13 = "0123456789012",
            Type = "food",
            Name = "Chocolat noir",
            PriceHtCents = 199,
            Dlc = "2026-12-31",
            DlcProvided = true,
            ConsumptionModes = ["takeaway"],
            ConsumptionModesProvided = true
        }).Value);

        var archive = article.Archive();

        Assert.True(archive.IsSuccess);
        Assert.Equal(ArticleLifecycleStatus.Active, archive.PreviousStatus);
        Assert.Equal(ArticleLifecycleStatus.Archived, archive.CurrentStatus);
        Assert.Equal(ArticleLifecycleStatus.Archived, article.LifecycleStatus);
        Assert.Equal("0123456789012", article.Ean13.Value);
        Assert.Equal(199, article.PriceHt.Cents);

        var reactivate = article.Reactivate();

        Assert.True(reactivate.IsSuccess);
        Assert.Equal(ArticleLifecycleStatus.Archived, reactivate.PreviousStatus);
        Assert.Equal(ArticleLifecycleStatus.Active, reactivate.CurrentStatus);
        Assert.True(article.IsActive);
    }

    [Fact]
    public void Rejects_repeated_lifecycle_transitions_without_changing_state()
    {
        var article = Assert.IsType<Article>(Article.Create(new ArticleDraft
        {
            Ean13 = "4006381333931",
            Type = "nonFood",
            Name = "Batterie",
            PriceHtCents = 2500,
            Packaging = "new",
            PackagingProvided = true
        }).Value);

        var alreadyActive = article.Reactivate();
        var archive = article.Archive();
        var alreadyArchived = article.Archive();

        Assert.False(alreadyActive.IsSuccess);
        Assert.Contains(alreadyActive.Errors, error => error.Code == "article.lifecycle.already_active");
        Assert.True(archive.IsSuccess);
        Assert.False(alreadyArchived.IsSuccess);
        Assert.Contains(alreadyArchived.Errors, error => error.Code == "article.lifecycle.already_archived");
        Assert.Equal(ArticleLifecycleStatus.Archived, article.LifecycleStatus);
    }

    [Fact]
    public void Updates_food_attributes_partially_without_changing_identity_or_price()
    {
        var article = Assert.IsType<Article>(Article.Create(new ArticleDraft
        {
            Ean13 = "0123456789012",
            Type = "food",
            Name = "Chocolat noir",
            PriceHtCents = 199,
            Dlc = "2026-12-31",
            DlcProvided = true,
            ConsumptionModes = ["takeaway"],
            ConsumptionModesProvided = true
        }).Value);

        var result = article.UpdateAttributes(new ArticleAttributeChanges
        {
            Name = "Chocolat noir bio",
            NameProvided = true,
            ConsumptionModes = ["takeaway", "onsite"],
            ConsumptionModesProvided = true
        });

        Assert.Equal(ArticleAttributeUpdateStatus.Updated, result.Status);
        Assert.Equal("0123456789012", article.Ean13.Value);
        Assert.Equal(ArticleType.Food, article.Type);
        Assert.Equal(199, article.PriceHt.Cents);
        Assert.Equal("Chocolat noir bio", article.Name);
        Assert.Equal(new DateOnly(2026, 12, 31), article.Dlc);
        Assert.Equal([ConsumptionMode.Takeaway, ConsumptionMode.OnSite], article.ConsumptionModes);
        Assert.Equal(
            ["name", "consumptionModes"],
            result.Changes.Select(change => change.Field).ToArray());
    }

    [Fact]
    public void Updates_non_food_packaging_and_rejects_food_fields()
    {
        var article = Assert.IsType<Article>(Article.Create(new ArticleDraft
        {
            Ean13 = "7351353713578",
            Type = "nonFood",
            Name = "Batterie",
            PriceHtCents = 2500,
            Packaging = "new",
            PackagingProvided = true
        }).Value);

        var result = article.UpdateAttributes(new ArticleAttributeChanges
        {
            Packaging = "unsellable",
            PackagingProvided = true,
            Dlc = "2026-12-31",
            DlcProvided = true
        });

        Assert.Equal(ArticleAttributeUpdateStatus.ValidationFailed, result.Status);
        Assert.Contains(result.Errors, error => error.Code == "article.dlc.not_applicable");
        Assert.Equal(PackagingCondition.New, article.Packaging);
    }

    [Fact]
    public void Rejects_immutable_and_unsupported_fields_without_mutating_the_article()
    {
        var article = Assert.IsType<Article>(Article.Create(new ArticleDraft
        {
            Ean13 = "4006381333931",
            Type = "nonFood",
            Name = "Batterie",
            PriceHtCents = 2500,
            Packaging = "new",
            PackagingProvided = true
        }).Value);

        var result = article.UpdateAttributes(new ArticleAttributeChanges
        {
            Name = "Nouvelle batterie",
            NameProvided = true,
            UnsupportedFields = ["ean13", "type", "priceHtCents", "status"]
        });

        Assert.Equal(ArticleAttributeUpdateStatus.ValidationFailed, result.Status);
        Assert.All(result.Errors, error => Assert.Equal("article.field.unsupported", error.Code));
        Assert.Equal("Batterie", article.Name);
        Assert.Equal(2500, article.PriceHt.Cents);
    }

    [Fact]
    public void Refuses_attribute_updates_for_an_archived_article()
    {
        var article = Assert.IsType<Article>(Article.Create(new ArticleDraft
        {
            Ean13 = "4006381333931",
            Type = "nonFood",
            Name = "Batterie",
            PriceHtCents = 2500,
            Packaging = "new",
            PackagingProvided = true
        }).Value);
        article.Archive();

        var result = article.UpdateAttributes(new ArticleAttributeChanges
        {
            Name = "Batterie archivée",
            NameProvided = true
        });

        Assert.Equal(ArticleAttributeUpdateStatus.Conflict, result.Status);
        Assert.Contains(result.Errors, error => error.Code == "article.update.archived");
        Assert.Equal("Batterie", article.Name);
    }
}
