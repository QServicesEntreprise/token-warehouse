using TokenWarehouse.Application;
using TokenWarehouse.Domain;
using Xunit;

namespace TokenWarehouse.Application.Tests;

public sealed class ArticleApplicationTests
{
    [Fact]
    public async Task Creates_and_reads_an_article_through_the_store_seam()
    {
        var store = new InMemoryArticleStore();
        var application = new ArticleApplication(store);
        var command = new CreateArticleCommand
        {
            Ean13 = "0123456789012",
            Type = "food",
            Name = "Chocolat noir",
            PriceHtCents = 199,
            Dlc = "2026-12-31",
            ConsumptionModes = ["takeaway", "onsite"]
        };

        var created = await application.CreateAsync(command);
        var read = await application.GetAsync(command.Ean13!);

        Assert.Equal(ArticleCreateStatus.Created, created.Status);
        Assert.Equal(ArticleReadStatus.Found, read.Status);
        Assert.Equal("0123456789012", read.Article?.Ean13.Value);
        Assert.Equal(ArticleType.Food, read.Article?.Type);
        Assert.Equal([ConsumptionMode.Takeaway, ConsumptionMode.OnSite], read.Article?.ConsumptionModes);
        Assert.Equal(199, read.Article?.PriceHt.Cents);
        Assert.Equal(new DateOnly(2026, 12, 31), read.Article?.Dlc);
        Assert.True(read.Article?.IsActive);
        Assert.Equal(1, store.InsertCalls);
    }

    [Fact]
    public async Task Invalid_creation_is_reported_without_writing()
    {
        var store = new InMemoryArticleStore();
        var application = new ArticleApplication(store);

        var result = await application.CreateAsync(new CreateArticleCommand
        {
            Ean13 = "0123456789013",
            Type = "food",
            Name = "Chocolat noir",
            PriceHtCents = 199,
            Dlc = "2026-12-31",
            ConsumptionModes = ["takeaway"]
        });

        Assert.Equal(ArticleCreateStatus.ValidationFailed, result.Status);
        Assert.Contains(result.Errors, error => error.Code == "article.ean13.invalid");
        Assert.Equal(0, store.InsertCalls);
    }

    [Fact]
    public async Task Repeated_ean_returns_a_stable_conflict()
    {
        var store = new InMemoryArticleStore();
        var application = new ArticleApplication(store);
        var command = new CreateArticleCommand
        {
            Ean13 = "4006381333931",
            Type = "nonFood",
            Name = "Batterie",
            PriceHtCents = 2500,
            Packaging = "refurbished"
        };

        Assert.Equal(ArticleCreateStatus.Created, (await application.CreateAsync(command)).Status);
        var conflict = await application.CreateAsync(command);

        Assert.Equal(ArticleCreateStatus.Conflict, conflict.Status);
        Assert.Contains(conflict.Errors, error => error.Code == "article.ean13.conflict" && error.Field == "ean13");
        Assert.Equal(1, store.InsertCalls);
    }

    [Fact]
    public async Task Updates_ht_and_returns_recalculated_quotes_through_the_store_seam()
    {
        var store = new InMemoryArticleStore();
        var application = new ArticleApplication(store);
        var command = new CreateArticleCommand
        {
            Ean13 = "0123456789012",
            Type = "food",
            Name = "Chocolat noir",
            PriceHtCents = 1000,
            Dlc = "2026-12-31",
            ConsumptionModes = ["takeaway", "onsite"]
        };

        await application.CreateAsync(command);
        var result = await application.UpdatePriceHtAsync(
            command.Ean13!,
            new UpdateArticlePriceCommand { PriceHtCents = 199 });

        Assert.Equal(ArticleUpdateStatus.Updated, result.Status);
        Assert.Equal(199, result.Article?.PriceHt.Cents);
        Assert.Equal(
            new[] { 210, 219 },
            result.Article?.PriceQuotes.Select(quote => quote.PriceTtc.Cents).ToArray());
        Assert.Equal(1, store.UpdateCalls);
        Assert.Equal(199, store.UpdatedArticle?.PriceHt.Cents);
    }

    [Fact]
    public async Task Rejects_invalid_price_updates_without_writing()
    {
        var store = new InMemoryArticleStore();
        var application = new ArticleApplication(store);
        var command = new CreateArticleCommand
        {
            Ean13 = "7351353713578",
            Type = "nonFood",
            Name = "Batterie",
            PriceHtCents = 1000,
            Packaging = "new"
        };

        await application.CreateAsync(command);
        var result = await application.UpdatePriceHtAsync(
            command.Ean13!,
            new UpdateArticlePriceCommand
            {
                PriceHtCents = null,
                UnsupportedFields = ["priceTtcCents"]
            });

        Assert.Equal(ArticleUpdateStatus.ValidationFailed, result.Status);
        Assert.Contains(result.Errors, error => error.Code == "article.priceHtCents.required");
        Assert.Contains(result.Errors, error => error.Code == "article.field.unsupported");
        Assert.Equal(0, store.UpdateCalls);
        Assert.Equal(1000, (await application.GetAsync(command.Ean13!)).Article?.PriceHt.Cents);
    }

    [Fact]
    public async Task Maps_a_store_update_conflict_without_changing_the_loaded_article()
    {
        var store = new InMemoryArticleStore { UpdateStatus = ArticleStoreUpdateStatus.Conflict };
        var application = new ArticleApplication(store);
        var command = new CreateArticleCommand
        {
            Ean13 = "7351353713578",
            Type = "nonFood",
            Name = "Batterie",
            PriceHtCents = 1000,
            Packaging = "new"
        };

        await application.CreateAsync(command);
        var result = await application.UpdatePriceHtAsync(
            command.Ean13!,
            new UpdateArticlePriceCommand { PriceHtCents = 199 });

        Assert.Equal(ArticleUpdateStatus.Conflict, result.Status);
        Assert.Equal(1000, (await application.GetAsync(command.Ean13!)).Article?.PriceHt.Cents);
    }

    private sealed class InMemoryArticleStore : IArticleStore
    {
        private readonly List<Article> articles = [];

        public int InsertCalls { get; private set; }

        public int UpdateCalls { get; private set; }

        public ArticleStoreUpdateStatus UpdateStatus { get; set; } = ArticleStoreUpdateStatus.Updated;

        public ArticleStorePriceUpdateCandidateStatus PriceUpdateCandidateStatus { get; set; } = ArticleStorePriceUpdateCandidateStatus.Active;

        public Article? UpdatedArticle { get; private set; }

        public ValueTask<Article?> FindByEanAsync(Ean13 ean13, CancellationToken cancellationToken = default)
            => ValueTask.FromResult(articles.SingleOrDefault(article => article.Ean13 == ean13));

        public ValueTask<ArticleStoreInsertStatus> InsertAsync(Article article, CancellationToken cancellationToken = default)
        {
            InsertCalls++;
            if (articles.Any(existing => existing.Ean13 == article.Ean13))
            {
                return ValueTask.FromResult(ArticleStoreInsertStatus.Conflict);
            }

            articles.Add(article);
            return ValueTask.FromResult(ArticleStoreInsertStatus.Created);
        }

        public ValueTask<ArticleStorePriceUpdateCandidate> FindForPriceUpdateAsync(
            Ean13 ean13,
            CancellationToken cancellationToken = default)
        {
            var article = articles.SingleOrDefault(existing => existing.Ean13 == ean13);
            return PriceUpdateCandidateStatus switch
            {
                ArticleStorePriceUpdateCandidateStatus.NotFound => ValueTask.FromResult(
                    new ArticleStorePriceUpdateCandidate(ArticleStorePriceUpdateCandidateStatus.NotFound, null)),
                ArticleStorePriceUpdateCandidateStatus.Archived => ValueTask.FromResult(
                    new ArticleStorePriceUpdateCandidate(ArticleStorePriceUpdateCandidateStatus.Archived, null)),
                _ when article is null => ValueTask.FromResult(
                    new ArticleStorePriceUpdateCandidate(ArticleStorePriceUpdateCandidateStatus.NotFound, null)),
                _ => ValueTask.FromResult(
                    new ArticleStorePriceUpdateCandidate(ArticleStorePriceUpdateCandidateStatus.Active, Clone(article)))
            };
        }

        public ValueTask<ArticleStoreUpdateStatus> UpdatePriceHtAsync(
            Article article,
            CancellationToken cancellationToken = default)
        {
            UpdateCalls++;
            UpdatedArticle = article;
            var existing = articles.SingleOrDefault(current => current.Ean13 == article.Ean13);
            if (existing is null)
            {
                return ValueTask.FromResult(ArticleStoreUpdateStatus.NotFound);
            }

            if (UpdateStatus != ArticleStoreUpdateStatus.Updated)
            {
                return ValueTask.FromResult(UpdateStatus);
            }

            existing.ChangePriceHt(article.PriceHt);
            return ValueTask.FromResult(ArticleStoreUpdateStatus.Updated);
        }

        private static Article Clone(Article article)
            => Assert.IsType<Article>(Article.Create(new ArticleDraft
            {
                Ean13 = article.Ean13.Value,
                Type = article.Type == ArticleType.Food ? "food" : "nonFood",
                Name = article.Name,
                PriceHtCents = article.PriceHt.Cents,
                Dlc = article.Dlc?.ToString("yyyy-MM-dd"),
                DlcProvided = article.Dlc is not null,
                ConsumptionModes = article.Type == ArticleType.Food
                    ? article.ConsumptionModes.Select(mode => mode == ConsumptionMode.Takeaway ? "takeaway" : "onsite").ToArray()
                    : null,
                ConsumptionModesProvided = article.Type == ArticleType.Food,
                Packaging = article.Packaging switch
                {
                    PackagingCondition.New => "new",
                    PackagingCondition.Refurbished => "refurbished",
                    PackagingCondition.Unsellable => "unsellable",
                    _ => null
                },
                PackagingProvided = article.Packaging is not null
            }).Value);
    }
}
