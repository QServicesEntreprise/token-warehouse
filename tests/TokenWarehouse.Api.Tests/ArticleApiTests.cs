using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;
using TokenWarehouse.Infrastructure.Persistence;
using Xunit;

namespace TokenWarehouse.Api.Tests;

public sealed class ArticleApiTests
{
    [Fact]
    public async Task Creates_food_article_and_reads_the_same_representation_after_a_new_request()
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();
        var payload = new
        {
            ean13 = "0123456789012",
            type = "food",
            name = "Chocolat noir",
            priceHtCents = 199,
            dlc = "2026-12-31",
            consumptionModes = new[] { "onsite", "takeaway" }
        };

        using var create = await client.PostAsJsonAsync("/api/articles", payload);
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        Assert.Equal("application/json", create.Content.Headers.ContentType?.MediaType);
        using var created = JsonDocument.Parse(await create.Content.ReadAsStringAsync());

        using var secondClient = factory.CreateClient();
        using var read = await secondClient.GetAsync("/api/articles/0123456789012");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        using var loaded = JsonDocument.Parse(await read.Content.ReadAsStringAsync());

        Assert.Equal(created.RootElement.GetRawText(), loaded.RootElement.GetRawText());
        Assert.Equal("0123456789012", loaded.RootElement.GetProperty("ean13").GetString());
        Assert.Equal("food", loaded.RootElement.GetProperty("type").GetString());
        Assert.Equal(199, loaded.RootElement.GetProperty("priceHtCents").GetInt32());
        Assert.True(loaded.RootElement.GetProperty("isActive").GetBoolean());
        Assert.Equal("2026-12-31", loaded.RootElement.GetProperty("dlc").GetString());
        Assert.Equal(
            new[] { "takeaway", "onsite" },
            loaded.RootElement.GetProperty("consumptionModes").EnumerateArray().Select(value => value.GetString()).ToArray());
        Assert.False(loaded.RootElement.TryGetProperty("packaging", out _));
    }

    [Fact]
    public async Task Persists_dlc_as_iso_calendar_under_a_non_gregorian_culture()
    {
        var culture = new CultureInfo("ar-SA");
        culture.DateTimeFormat.Calendar = new UmAlQuraCalendar();
        using var factory = new ArticleHostFactory(culture);
        using var client = factory.CreateClient();
        using var create = await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "0123456789012",
            type = "food",
            name = "Chocolat noir",
            priceHtCents = 199,
            dlc = "2026-12-31",
            consumptionModes = new[] { "takeaway" }
        });

        Assert.Equal(HttpStatusCode.Created, create.StatusCode);

        using var secondClient = factory.CreateClient();
        using var read = await secondClient.GetAsync("/api/articles/0123456789012");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        using var body = JsonDocument.Parse(await read.Content.ReadAsStringAsync());

        Assert.Equal("2026-12-31", body.RootElement.GetProperty("dlc").GetString());
    }

    [Fact]
    public async Task Creates_non_food_article_with_only_packaging()
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();

        using var response = await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "4006381333931",
            type = "nonFood",
            name = "Batterie",
            priceHtCents = 2500,
            packaging = "refurbished"
        });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("nonFood", body.RootElement.GetProperty("type").GetString());
        Assert.Equal("refurbished", body.RootElement.GetProperty("packaging").GetString());
        Assert.False(body.RootElement.TryGetProperty("dlc", out _));
        Assert.False(body.RootElement.TryGetProperty("consumptionModes", out _));
    }

    [Fact]
    public async Task Invalid_ean_returns_problem_details_with_a_field_error()
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();

        using var response = await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "0123456789013",
            type = "food",
            name = "Chocolat noir",
            priceHtCents = 199,
            dlc = "2026-12-31",
            consumptionModes = new[] { "takeaway" }
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("article.validation", body.RootElement.GetProperty("code").GetString());
        Assert.True(body.RootElement.GetProperty("errors").TryGetProperty("ean13", out _));
    }

    [Theory]
    [InlineData("\"199\"")]
    [InlineData("199.0")]
    [InlineData("199.5")]
    public async Task Non_integer_price_shapes_are_rejected_with_a_price_field_error(string priceJson)
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();
        using var content = new StringContent(
            $$"""{"ean13":"0123456789012","type":"food","name":"Chocolat noir","priceHtCents":{{priceJson}},"dlc":"2026-12-31","consumptionModes":["takeaway"]}""",
            Encoding.UTF8,
            "application/json");

        using var response = await client.PostAsync("/api/articles", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("article.validation", body.RootElement.GetProperty("code").GetString());
        Assert.True(body.RootElement.GetProperty("errors").TryGetProperty("priceHtCents", out _));

        using var read = await client.GetAsync("/api/articles/0123456789012");
        Assert.Equal(HttpStatusCode.NotFound, read.StatusCode);
    }

    [Fact]
    public async Task Repeated_ean_returns_conflict_without_creating_a_second_article()
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();
        var payload = new
        {
            ean13 = "7351353713578",
            type = "nonFood",
            name = "Batterie",
            priceHtCents = 2500,
            packaging = "new"
        };

        using var first = await client.PostAsJsonAsync("/api/articles", payload);
        using var second = await client.PostAsJsonAsync("/api/articles", payload);

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        Assert.Equal("application/problem+json", second.Content.Headers.ContentType?.MediaType);
        using var body = JsonDocument.Parse(await second.Content.ReadAsStringAsync());
        Assert.Equal("article.ean13.conflict", body.RootElement.GetProperty("code").GetString());
        Assert.True(body.RootElement.GetProperty("errors").TryGetProperty("ean13", out _));

        using var read = await client.GetAsync("/api/articles/7351353713578");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
    }

    [Fact]
    public async Task Concurrent_same_ean_requests_leave_one_article_and_one_stable_conflict()
    {
        using var factory = new ArticleHostFactory();
        using var firstClient = factory.CreateClient();
        using var secondClient = factory.CreateClient();
        var payload = new
        {
            ean13 = "7351353713578",
            type = "nonFood",
            name = "Batterie",
            priceHtCents = 2500,
            packaging = "new"
        };

        var responses = await Task.WhenAll(
            firstClient.PostAsJsonAsync("/api/articles", payload),
            secondClient.PostAsJsonAsync("/api/articles", payload));
        try
        {
            var statuses = responses.Select(response => response.StatusCode).ToArray();
            Assert.Equal(1, statuses.Count(status => status == HttpStatusCode.Created));
            Assert.Equal(1, statuses.Count(status => status == HttpStatusCode.Conflict));
        }
        finally
        {
            foreach (var response in responses)
            {
                response.Dispose();
            }
        }
    }

    [Fact]
    public async Task Real_store_maps_the_sqlite_unique_constraint_to_a_conflict()
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<IArticleStore>();
        var article = Assert.IsType<Article>(Article.Create(new ArticleDraft
        {
            Ean13 = "7351353713578",
            Type = "nonFood",
            Name = "Batterie",
            PriceHtCents = 2500,
            Packaging = "new",
            PackagingProvided = true
        }).Value);

        Assert.Equal(ArticleStoreInsertStatus.Created, await store.InsertAsync(article));
        Assert.Equal(ArticleStoreInsertStatus.Conflict, await store.InsertAsync(article));
    }

    [Fact]
    public async Task Missing_or_cross_classification_fields_are_rejected_before_persistence()
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();

        using var response = await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "4006381333931",
            type = "food",
            name = "Café",
            priceHtCents = 100,
            packaging = "new"
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var errors = body.RootElement.GetProperty("errors");
        Assert.True(errors.TryGetProperty("dlc", out _));
        Assert.True(errors.TryGetProperty("consumptionModes", out _));
        Assert.True(errors.TryGetProperty("packaging", out _));

        using var read = await client.GetAsync("/api/articles/4006381333931");
        Assert.Equal(HttpStatusCode.NotFound, read.StatusCode);
    }

    [Fact]
    public async Task Unknown_article_returns_not_found_problem_details()
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/api/articles/4006381333931");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("article.not_found", body.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Unexpected_storage_failure_returns_generic_problem_details()
    {
        using var factory = new FailingStoreHostFactory();
        using var client = factory.CreateClient();

        using var response = await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "0123456789012",
            type = "food",
            name = "Chocolat noir",
            priceHtCents = 199,
            dlc = "2026-12-31",
            consumptionModes = new[] { "takeaway" }
        });

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain(nameof(InvalidOperationException), body);
        Assert.DoesNotContain("Articles", body);
        Assert.DoesNotContain("SQLite", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Lists_active_articles_by_default_and_exposes_archived_and_all_views()
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();

        await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "0123456789012",
            type = "food",
            name = "Café du Comptoir",
            priceHtCents = 199,
            dlc = "2026-12-31",
            consumptionModes = new[] { "takeaway", "onsite" }
        });
        await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "4006381333931",
            type = "nonFood",
            name = "Batterie neuve",
            priceHtCents = 2500,
            packaging = "new"
        });
        await SeedArchivedArticles(factory.Services);

        using var active = await client.GetAsync("/api/articles");
        using var archived = await client.GetAsync("/api/articles?status=archived");
        using var all = await client.GetAsync("/api/articles?status=all");

        Assert.Equal(HttpStatusCode.OK, active.StatusCode);
        Assert.Equal(HttpStatusCode.OK, archived.StatusCode);
        Assert.Equal(HttpStatusCode.OK, all.StatusCode);
        Assert.Equal(
            ["Batterie neuve", "Café du Comptoir"],
            await ReadNames(active));
        Assert.Equal(
            ["Biscuit historique", "Lampe historique"],
            await ReadNames(archived));
        Assert.Equal(
            ["Batterie neuve", "Biscuit historique", "Café du Comptoir", "Lampe historique"],
            await ReadNames(all));

        using var archivedDetail = await client.GetAsync("/api/articles/5901234123457");
        Assert.Equal(HttpStatusCode.OK, archivedDetail.StatusCode);
        using var archivedBody = JsonDocument.Parse(await archivedDetail.Content.ReadAsStringAsync());
        Assert.False(archivedBody.RootElement.GetProperty("isActive").GetBoolean());
        Assert.Equal("5901234123457", archivedBody.RootElement.GetProperty("ean13").GetString());
    }

    [Fact]
    public async Task Searches_by_name_or_ean_and_applies_filter_intersections()
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();
        await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "0123456789012",
            type = "food",
            name = "Biscuit à emporter",
            priceHtCents = 199,
            dlc = "2026-12-31",
            consumptionModes = new[] { "takeaway" }
        });
        await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "4006381333931",
            type = "food",
            name = "Plat sur place",
            priceHtCents = 499,
            dlc = "2026-12-31",
            consumptionModes = new[] { "onsite" }
        });
        await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "5901234123457",
            type = "food",
            name = "Café aux deux modes",
            priceHtCents = 299,
            dlc = "2026-12-31",
            consumptionModes = new[] { "takeaway", "onsite" }
        });
        await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "7351353713578",
            type = "nonFood",
            name = "Lampe neuve",
            priceHtCents = 3500,
            packaging = "new"
        });
        await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "5012345678900",
            type = "nonFood",
            name = "Lampe reconditionnée",
            priceHtCents = 2900,
            packaging = "refurbished"
        });

        using var nameSearch = await client.GetAsync("/api/articles?search=%20CAF%C3%89%20");
        using var eanSearch = await client.GetAsync("/api/articles?search=0123456789012");
        using var emptySearch = await client.GetAsync("/api/articles?search=%20%20");
        using var takeaway = await client.GetAsync("/api/articles?mode=takeaway");
        using var onsiteFood = await client.GetAsync("/api/articles?type=food&mode=onsite");
        using var newPackaging = await client.GetAsync("/api/articles?packaging=new");
        using var incompatible = await client.GetAsync("/api/articles?type=food&packaging=new");
        using var opposite = await client.GetAsync("/api/articles?type=nonFood&mode=takeaway");

        Assert.Equal(["Café aux deux modes"], await ReadNames(nameSearch));
        Assert.Equal(["Biscuit à emporter"], await ReadNames(eanSearch));
        Assert.Equal(5, (await ReadNames(emptySearch)).Count);
        Assert.Equal(["Biscuit à emporter", "Café aux deux modes"], await ReadNames(takeaway));
        Assert.Equal(["Café aux deux modes", "Plat sur place"], await ReadNames(onsiteFood));
        Assert.Equal(["Lampe neuve"], await ReadNames(newPackaging));
        Assert.Equal(HttpStatusCode.OK, incompatible.StatusCode);
        Assert.Equal(HttpStatusCode.OK, opposite.StatusCode);
        Assert.Empty(await ReadNames(incompatible));
        Assert.Empty(await ReadNames(opposite));

        using var eanBody = JsonDocument.Parse(await eanSearch.Content.ReadAsStringAsync());
        Assert.Equal("0123456789012", eanBody.RootElement[0].GetProperty("ean13").GetString());
        Assert.False(eanBody.RootElement[0].TryGetProperty("packaging", out _));
    }

    [Theory]
    [InlineData("status", "retired")]
    [InlineData("type", "grocery")]
    [InlineData("mode", "delivery")]
    [InlineData("packaging", "damaged")]
    public async Task Invalid_list_filters_return_structured_problem_details(
        string field,
        string value)
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();

        using var response = await client.GetAsync($"/api/articles?{field}={value}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("article.validation", body.RootElement.GetProperty("code").GetString());
        Assert.True(body.RootElement.GetProperty("errors").TryGetProperty(field, out _));
    }

    [Fact]
    public async Task Unexpected_list_storage_failure_returns_sanitized_problem_details()
    {
        using var factory = new FailingStoreHostFactory();
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/api/articles");

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain(nameof(InvalidOperationException), body);
        Assert.DoesNotContain("database internals", body);
        Assert.DoesNotContain("SQLite", body, StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<IReadOnlyList<string?>> ReadNames(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement
            .EnumerateArray()
            .Select(article => article.GetProperty("name").GetString())
            .ToArray();
    }

    private static async Task SeedArchivedArticles(IServiceProvider services)
    {
        using var scope = services.CreateScope();
        var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
        await using var context = await contextFactory.CreateDbContextAsync();
        context.Articles.AddRange(
            new ArticleEntity
            {
                Ean13 = "5901234123457",
                Type = "food",
                Name = "Biscuit historique",
                PriceHtCents = 299,
                IsActive = false,
                Dlc = "2026-12-31",
                ConsumptionModes = "takeaway"
            },
            new ArticleEntity
            {
                Ean13 = "5012345678900",
                Type = "nonFood",
                Name = "Lampe historique",
                PriceHtCents = 2900,
                IsActive = false,
                Packaging = "refurbished"
            });
        await context.SaveChangesAsync();
    }

    private sealed class ArticleHostFactory : WebApplicationFactory<Program>
    {
        private readonly string databasePath = Path.Combine(Path.GetTempPath(), $"token-warehouse-article-{Guid.NewGuid():N}.db");
        private readonly CultureInfo? requestCulture;

        public ArticleHostFactory(CultureInfo? requestCulture = null)
        {
            this.requestCulture = requestCulture;
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:Warehouse", $"Data Source={databasePath}");
            if (requestCulture is not null)
            {
                builder.ConfigureServices(services =>
                    services.AddSingleton<IStartupFilter>(new RequestCultureStartupFilter(requestCulture)));
            }
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (disposing)
            {
                File.Delete(databasePath);
                File.Delete($"{databasePath}-shm");
                File.Delete($"{databasePath}-wal");
            }
        }
    }

    private sealed class RequestCultureStartupFilter(CultureInfo culture) : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
            => app =>
            {
                app.Use(async (_, nextMiddleware) =>
                {
                    var previousCulture = CultureInfo.CurrentCulture;
                    var previousUiCulture = CultureInfo.CurrentUICulture;
                    CultureInfo.CurrentCulture = culture;
                    CultureInfo.CurrentUICulture = culture;
                    try
                    {
                        await nextMiddleware();
                    }
                    finally
                    {
                        CultureInfo.CurrentCulture = previousCulture;
                        CultureInfo.CurrentUICulture = previousUiCulture;
                    }
                });
                next(app);
            };
    }

    private sealed class FailingStoreHostFactory : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IArticleStore>();
                services.AddScoped<IArticleStore, FailingArticleStore>();
            });
        }
    }

    private sealed class FailingArticleStore : IArticleStore
    {
        public ValueTask<Article?> FindByEanAsync(Ean13 ean13, CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("database internals");

        public ValueTask<ArticleStoreInsertStatus> InsertAsync(Article article, CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("database internals");

        public ValueTask<IReadOnlyList<Article>> ListAsync(
            ArticleListFilter filter,
            CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("database internals");
    }
}
