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
    public async Task Lists_articles_with_a_normalized_typed_filter()
    {
        var store = new InMemoryArticleStore
        {
            ListResult =
            [
                CreateArticle("0123456789012", "food", "Café de la Place", ["takeaway"])
            ]
        };
        var application = new ArticleApplication(store);

        var result = await application.ListAsync(new ArticleListQuery
        {
            Search = "  café ",
            Type = "food",
            Mode = "takeaway"
        });

        Assert.Equal(ArticleListStatus.Success, result.Status);
        Assert.Equal("Café de la Place", Assert.Single(result.Articles).Name);
        Assert.Equal(
            new ArticleListFilter(
                ArticleLifecycleFilter.Active,
                "café",
                ArticleType.Food,
                ConsumptionMode.Takeaway,
                null),
            store.LastListFilter);
        Assert.Equal(0, store.InsertCalls);
    }

    [Fact]
    public async Task Lists_explicit_archived_and_all_views_without_mutation()
    {
        var store = new InMemoryArticleStore
        {
            ListResult =
            [
                CreateArticle("4006381333931", "nonFood", "Batterie archivée", null, false),
                CreateArticle("7351353713578", "nonFood", "Batterie active", null)
            ]
        };
        var application = new ArticleApplication(store);

        var archived = await application.ListAsync(new ArticleListQuery { Status = "archived" });
        var all = await application.ListAsync(new ArticleListQuery { Status = "all" });

        Assert.Equal(ArticleListStatus.Success, archived.Status);
        Assert.Equal(ArticleListStatus.Success, all.Status);
        Assert.False(Assert.Single(archived.Articles).IsActive);
        Assert.Equal(2, all.Articles.Count);
        Assert.Equal(ArticleLifecycleFilter.All, store.LastListFilter?.Status);
        Assert.Equal(0, store.InsertCalls);
    }

    [Fact]
    public async Task Keeps_a_valid_empty_catalogue_as_a_successful_read()
    {
        var store = new InMemoryArticleStore();
        var application = new ArticleApplication(store);

        var result = await application.ListAsync(new ArticleListQuery { Search = "aucun résultat" });

        Assert.Equal(ArticleListStatus.Success, result.Status);
        Assert.Empty(result.Articles);
        Assert.Equal("aucun résultat", store.LastListFilter?.Search);
        Assert.Equal(0, store.InsertCalls);
    }

    [Theory]
    [InlineData("status", "retired")]
    [InlineData("type", "grocery")]
    [InlineData("mode", "delivery")]
    [InlineData("packaging", "damaged")]
    public async Task Invalid_list_filters_are_reported_without_calling_the_store(string field, string value)
    {
        var store = new InMemoryArticleStore();
        var application = new ArticleApplication(store);
        var query = field switch
        {
            "status" => new ArticleListQuery { Status = value },
            "type" => new ArticleListQuery { Type = value },
            "mode" => new ArticleListQuery { Mode = value },
            _ => new ArticleListQuery { Packaging = value }
        };

        var result = await application.ListAsync(query);

        Assert.Equal(ArticleListStatus.ValidationFailed, result.Status);
        Assert.Contains(result.Errors, error => error.Field == field);
        Assert.Null(store.LastListFilter);
    }

    private static Article CreateArticle(
        string ean13,
        string type,
        string name,
        IReadOnlyList<string>? modes,
        bool isActive = true)
    {
        var result = Article.Reconstitute(
            new ArticleDraft
            {
                Ean13 = ean13,
                Type = type,
                Name = name,
                PriceHtCents = 100,
                Dlc = type == "food" ? "2026-12-31" : null,
                DlcProvided = type == "food",
                ConsumptionModes = modes,
                ConsumptionModesProvided = modes is not null,
                Packaging = type == "nonFood" ? "new" : null,
                PackagingProvided = type == "nonFood"
            },
            isActive);

        return Assert.IsType<Article>(result.Value);
    }

    private sealed class InMemoryArticleStore : IArticleStore
    {
        private readonly List<Article> articles = [];

        public int InsertCalls { get; private set; }

        public ArticleListFilter? LastListFilter { get; private set; }

        public IReadOnlyList<Article> ListResult { get; init; } = [];

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

        public ValueTask<IReadOnlyList<Article>> ListAsync(
            ArticleListFilter filter,
            CancellationToken cancellationToken = default)
        {
            LastListFilter = filter;
            var matches = ListResult.AsEnumerable();
            matches = filter.Status switch
            {
                ArticleLifecycleFilter.Active => matches.Where(article => article.IsActive),
                ArticleLifecycleFilter.Archived => matches.Where(article => !article.IsActive),
                _ => matches
            };

            if (filter.Type is not null)
            {
                matches = matches.Where(article => article.Type == filter.Type);
            }

            if (filter.Search is not null)
            {
                matches = matches.Where(article =>
                    article.Ean13.Value == filter.Search
                    || article.Name.Contains(filter.Search, StringComparison.OrdinalIgnoreCase));
            }

            if (filter.Mode is not null)
            {
                matches = matches.Where(article =>
                    article.Type == ArticleType.Food
                    && article.ConsumptionModes.Contains(filter.Mode.Value));
            }

            if (filter.Packaging is not null)
            {
                matches = matches.Where(article =>
                    article.Type == ArticleType.NonFood
                    && article.Packaging == filter.Packaging);
            }

            return ValueTask.FromResult<IReadOnlyList<Article>>(
                matches.OrderBy(article => article.Name).ThenBy(article => article.Ean13.Value).ToArray());
        }
    }
}
