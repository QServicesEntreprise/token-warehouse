using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
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
    }
}
