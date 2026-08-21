using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Data.Common;
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
    public async Task Gets_and_patches_food_quotes_in_cents_without_persisting_ttc()
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();
        using var create = await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "0123456789012",
            type = "food",
            name = "Chocolat noir",
            priceHtCents = 1000,
            dlc = "2026-12-31",
            consumptionModes = new[] { "takeaway", "onsite" }
        });

        Assert.Equal(HttpStatusCode.Created, create.StatusCode);

        using var patchRequest = new HttpRequestMessage(HttpMethod.Patch, "/api/articles/0123456789012")
        {
            Content = JsonContent.Create(new { priceHtCents = 199 })
        };
        using var patch = await client.SendAsync(patchRequest);
        Assert.Equal(HttpStatusCode.OK, patch.StatusCode);
        Assert.Equal("application/json", patch.Content.Headers.ContentType?.MediaType);
        using var patched = JsonDocument.Parse(await patch.Content.ReadAsStringAsync());

        Assert.Equal(199, patched.RootElement.GetProperty("priceHtCents").GetInt32());
        Assert.Equal("0123456789012", patched.RootElement.GetProperty("ean13").GetString());
        Assert.Equal("food", patched.RootElement.GetProperty("type").GetString());
        Assert.Equal("2026-12-31", patched.RootElement.GetProperty("dlc").GetString());
        Assert.Equal(
            new[] { "takeaway", "onsite" },
            patched.RootElement.GetProperty("consumptionModes").EnumerateArray().Select(value => value.GetString()).ToArray());
        Assert.Equal(2, patched.RootElement.GetProperty("priceQuotes").GetArrayLength());
        var patchedQuotes = patched.RootElement.GetProperty("priceQuotes").EnumerateArray().ToArray();
        Assert.Equal("takeaway", patchedQuotes[0].GetProperty("saleContext").GetString());
        Assert.Equal(11, patchedQuotes[0].GetProperty("vatCents").GetInt32());
        Assert.Equal(210, patchedQuotes[0].GetProperty("priceTtcCents").GetInt32());
        Assert.Equal("onsite", patchedQuotes[1].GetProperty("saleContext").GetString());
        Assert.Equal(20, patchedQuotes[1].GetProperty("vatCents").GetInt32());
        Assert.Equal(219, patchedQuotes[1].GetProperty("priceTtcCents").GetInt32());
        Assert.Equal("11/200", patchedQuotes[0].GetProperty("taxRate").GetProperty("ratio").GetString());
        Assert.Equal("1/10", patchedQuotes[1].GetProperty("taxRate").GetProperty("ratio").GetString());

        using var secondClient = factory.CreateClient();
        using var read = await secondClient.GetAsync("/api/articles/0123456789012");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        using var loaded = JsonDocument.Parse(await read.Content.ReadAsStringAsync());
        Assert.Equal(patched.RootElement.GetRawText(), loaded.RootElement.GetRawText());
        Assert.False(loaded.RootElement.TryGetProperty("priceTtcCents", out _));
        Assert.False(loaded.RootElement.TryGetProperty("vatCents", out _));
    }

    [Fact]
    public async Task Patching_catalog_price_keeps_a_persisted_sale_snapshot_unchanged()
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();
        using var create = await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "0123456789012",
            type = "food",
            name = "Chocolat noir",
            priceHtCents = 1000,
            dlc = "2026-12-31",
            consumptionModes = new[] { "takeaway", "onsite" }
        });

        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var before = new SaleSnapshot("0123456789012", "takeaway", 1000, 2, 2000, 110, 2110);
        await PersistSaleSnapshotAsync(factory, before);

        using var patchRequest = new HttpRequestMessage(HttpMethod.Patch, "/api/articles/0123456789012")
        {
            Content = JsonContent.Create(new { priceHtCents = 199 })
        };
        using var patch = await client.SendAsync(patchRequest);
        Assert.Equal(HttpStatusCode.OK, patch.StatusCode);

        using var secondClient = factory.CreateClient();
        using var read = await secondClient.GetAsync("/api/articles/0123456789012");
        using var article = JsonDocument.Parse(await read.Content.ReadAsStringAsync());
        Assert.Equal(199, article.RootElement.GetProperty("priceHtCents").GetInt32());

        var after = await ReadSaleSnapshotAsync(factory);
        Assert.Equal(before, after);
    }

    [Fact]
    public async Task Gets_non_food_quote_without_a_sale_context()
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();
        using var create = await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "7351353713578",
            type = "nonFood",
            name = "Batterie",
            priceHtCents = 1000,
            packaging = "new"
        });

        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        using var body = JsonDocument.Parse(await create.Content.ReadAsStringAsync());
        var quote = Assert.Single(body.RootElement.GetProperty("priceQuotes").EnumerateArray());

        Assert.False(quote.TryGetProperty("saleContext", out _));
        Assert.Equal("nonFood", quote.GetProperty("taxRate").GetProperty("code").GetString());
        Assert.Equal("1/5", quote.GetProperty("taxRate").GetProperty("ratio").GetString());
        Assert.Equal(200, quote.GetProperty("vatCents").GetInt32());
        Assert.Equal(1200, quote.GetProperty("priceTtcCents").GetInt32());
    }

    [Fact]
    public async Task Patches_food_attributes_persists_them_and_exposes_one_history_fact()
    {
        using var factory = new ArticleHostFactory();
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

        using var patch = await client.PatchAsJsonAsync("/api/articles/0123456789012", new
        {
            name = "Chocolat noir bio",
            dlc = "2027-01-31",
            consumptionModes = new[] { "takeaway", "onsite" }
        });

        Assert.Equal(HttpStatusCode.OK, patch.StatusCode);
        using var patched = JsonDocument.Parse(await patch.Content.ReadAsStringAsync());
        Assert.Equal("Chocolat noir bio", patched.RootElement.GetProperty("name").GetString());
        Assert.Equal("2027-01-31", patched.RootElement.GetProperty("dlc").GetString());
        Assert.Equal(
            new[] { "takeaway", "onsite" },
            patched.RootElement.GetProperty("consumptionModes").EnumerateArray().Select(value => value.GetString()).ToArray());
        Assert.Equal(199, patched.RootElement.GetProperty("priceHtCents").GetInt32());

        using var secondClient = factory.CreateClient();
        using var read = await secondClient.GetAsync("/api/articles/0123456789012");
        using var loaded = JsonDocument.Parse(await read.Content.ReadAsStringAsync());
        Assert.Equal("Chocolat noir bio", loaded.RootElement.GetProperty("name").GetString());
        Assert.Equal("2027-01-31", loaded.RootElement.GetProperty("dlc").GetString());

        using var history = await secondClient.GetAsync("/api/history?ean13=0123456789012");
        using var facts = JsonDocument.Parse(await history.Content.ReadAsStringAsync());
        var fact = Assert.Single(facts.RootElement.EnumerateArray());
        Assert.Equal("attributes", fact.GetProperty("kind").GetString());
        Assert.Equal("name", fact.GetProperty("changes")[0].GetProperty("field").GetString());
        Assert.Equal("Chocolat noir", fact.GetProperty("changes")[0].GetProperty("previousValue").GetString());
        Assert.Equal("Chocolat noir bio", fact.GetProperty("changes")[0].GetProperty("nextValue").GetString());
    }

    [Fact]
    public async Task Patches_non_food_packaging_and_rejects_cross_type_or_price_fields()
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();
        using var create = await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "7351353713578",
            type = "nonFood",
            name = "Batterie",
            priceHtCents = 2500,
            packaging = "new"
        });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);

        using var patch = await client.PatchAsJsonAsync("/api/articles/7351353713578", new { packaging = "unsellable" });
        Assert.Equal(HttpStatusCode.OK, patch.StatusCode);
        using var patched = JsonDocument.Parse(await patch.Content.ReadAsStringAsync());
        Assert.Equal("unsellable", patched.RootElement.GetProperty("packaging").GetString());

        using var invalid = await client.PatchAsJsonAsync("/api/articles/7351353713578", new
        {
            dlc = "2027-01-31",
            priceHtCents = 999
        });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        using var problem = JsonDocument.Parse(await invalid.Content.ReadAsStringAsync());
        Assert.Equal("article.validation", problem.RootElement.GetProperty("code").GetString());
        Assert.True(problem.RootElement.GetProperty("errors").TryGetProperty("dlc", out _));
        Assert.True(problem.RootElement.GetProperty("errors").TryGetProperty("priceHtCents", out _));

        using var read = await client.GetAsync("/api/articles/7351353713578");
        using var loaded = JsonDocument.Parse(await read.Content.ReadAsStringAsync());
        Assert.Equal("unsellable", loaded.RootElement.GetProperty("packaging").GetString());
        Assert.Equal(2500, loaded.RootElement.GetProperty("priceHtCents").GetInt32());
    }

    [Fact]
    public async Task Attribute_updates_recompute_sellability_without_changing_physical_stock()
    {
        const string foodEan = "0123456789012";
        const string nonFoodEan = "7351353713578";
        var day = new DateTimeOffset(2026, 8, 21, 10, 30, 0, TimeSpan.Zero);
        using var factory = new ArticleHostFactory(fixedNow: day);
        using var client = factory.CreateClient();

        using var foodCreate = await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = foodEan,
            type = "food",
            name = "Chocolat noir",
            priceHtCents = 199,
            dlc = "2026-08-20",
            consumptionModes = new[] { "takeaway" }
        });
        Assert.Equal(HttpStatusCode.Created, foodCreate.StatusCode);
        await SeedStockPositionAsync(factory.Services, foodEan, 12);

        using var foodPatch = await client.PatchAsJsonAsync($"/api/articles/{foodEan}", new
        {
            dlc = "2026-08-21"
        });
        Assert.Equal(HttpStatusCode.OK, foodPatch.StatusCode);
        using var foodPatched = JsonDocument.Parse(await foodPatch.Content.ReadAsStringAsync());
        var foodStockOnDlc = foodPatched.RootElement.GetProperty("stock");
        Assert.Equal(12, foodStockOnDlc.GetProperty("physicalQuantity").GetInt32());
        Assert.Equal(12, foodStockOnDlc.GetProperty("sellableQuantity").GetInt32());

        factory.SetNow(day.AddDays(1));
        using var foodRead = await client.GetAsync($"/api/articles/{foodEan}");
        using var foodLoaded = JsonDocument.Parse(await foodRead.Content.ReadAsStringAsync());
        var foodStockTheNextDay = foodLoaded.RootElement.GetProperty("stock");
        Assert.Equal(12, foodStockTheNextDay.GetProperty("physicalQuantity").GetInt32());
        Assert.Equal(0, foodStockTheNextDay.GetProperty("sellableQuantity").GetInt32());

        using var nonFoodCreate = await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = nonFoodEan,
            type = "nonFood",
            name = "Batterie",
            priceHtCents = 2500,
            packaging = "new"
        });
        Assert.Equal(HttpStatusCode.Created, nonFoodCreate.StatusCode);
        await SeedStockPositionAsync(factory.Services, nonFoodEan, 7);

        using var nonFoodPatch = await client.PatchAsJsonAsync($"/api/articles/{nonFoodEan}", new
        {
            packaging = "unsellable"
        });
        Assert.Equal(HttpStatusCode.OK, nonFoodPatch.StatusCode);
        using var nonFoodPatched = JsonDocument.Parse(await nonFoodPatch.Content.ReadAsStringAsync());
        var nonFoodStock = nonFoodPatched.RootElement.GetProperty("stock");
        Assert.Equal(7, nonFoodStock.GetProperty("physicalQuantity").GetInt32());
        Assert.Equal(0, nonFoodStock.GetProperty("sellableQuantity").GetInt32());

        using var nonFoodRead = await client.GetAsync($"/api/articles/{nonFoodEan}");
        using var nonFoodLoaded = JsonDocument.Parse(await nonFoodRead.Content.ReadAsStringAsync());
        Assert.Equal(
            7,
            nonFoodLoaded.RootElement.GetProperty("stock").GetProperty("physicalQuantity").GetInt32());
    }

    [Fact]
    public async Task Stock_collection_returns_one_stable_row_per_article_with_state_and_reason()
    {
        var day = new DateTimeOffset(2030, 1, 15, 10, 30, 0, TimeSpan.Zero);
        using var factory = new ArticleHostFactory(fixedNow: day);
        using var client = factory.CreateClient();

        async Task CreateArticle(object payload, string ean13, int? physicalQuantity = null)
        {
            using var response = await client.PostAsJsonAsync("/api/articles", payload);
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            if (physicalQuantity is not null)
            {
                await SeedStockPositionAsync(factory.Services, ean13, physicalQuantity.Value);
            }
        }

        await CreateArticle(new
        {
            ean13 = "0123456789012",
            type = "food",
            name = "Alimentaire double mode",
            priceHtCents = 100,
            dlc = "2030-01-15",
            consumptionModes = new[] { "takeaway", "onsite" }
        }, "0123456789012", 5);
        await CreateArticle(new
        {
            ean13 = "4006381333931",
            type = "food",
            name = "Alimentaire expiré",
            priceHtCents = 100,
            dlc = "2030-01-14",
            consumptionModes = new[] { "takeaway" }
        }, "4006381333931", 7);
        await CreateArticle(new
        {
            ean13 = "7351353713578",
            type = "nonFood",
            name = "Article archivé",
            priceHtCents = 100,
            packaging = "new"
        }, "7351353713578", 4);
        using (var archive = await client.PostAsync("/api/articles/7351353713578/archive", null))
        {
            Assert.Equal(HttpStatusCode.OK, archive.StatusCode);
        }
        await CreateArticle(new
        {
            ean13 = "5901234123457",
            type = "nonFood",
            name = "Packaging invendable",
            priceHtCents = 100,
            packaging = "unsellable"
        }, "5901234123457", 3);
        await CreateArticle(new
        {
            ean13 = "5012345678900",
            type = "nonFood",
            name = "Article vendable",
            priceHtCents = 100,
            packaging = "new"
        }, "5012345678900", 8);
        await CreateArticle(new
        {
            ean13 = "1234567890128",
            type = "food",
            name = "Article sans position",
            priceHtCents = 100,
            dlc = "2030-01-15",
            consumptionModes = new[] { "takeaway" }
        }, "1234567890128");
        Assert.Equal(0, await CountStockPositionsAsync(factory.Services, "1234567890128"));

        using var first = await client.GetAsync("/api/stock");
        using var second = await client.GetAsync("/api/stock");
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal("application/json", first.Content.Headers.ContentType?.MediaType);
        var firstBody = await first.Content.ReadAsStringAsync();
        Assert.Equal(firstBody, await second.Content.ReadAsStringAsync());
        using var rows = JsonDocument.Parse(firstBody);
        var positions = rows.RootElement.EnumerateArray().ToArray();

        Assert.Equal(6, positions.Length);
        Assert.Equal(
            ["0123456789012", "1234567890128", "4006381333931", "5012345678900", "5901234123457", "7351353713578"],
            positions.Select(row => row.GetProperty("ean13").GetString()!).ToArray());

        var available = positions.Single(row => row.GetProperty("ean13").GetString() == "0123456789012");
        Assert.Equal(5, available.GetProperty("physicalQuantity").GetInt32());
        Assert.Equal(5, available.GetProperty("sellableQuantity").GetInt32());
        Assert.Equal("AVAILABLE", available.GetProperty("availability").GetString());
        Assert.Equal("Alimentaire double mode", available.GetProperty("name").GetString());
        Assert.Equal(2, available.GetProperty("consumptionModes").GetArrayLength());
        Assert.False(available.TryGetProperty("packaging", out _));
        Assert.Null(available.GetProperty("reason").GetString());

        var outOfStock = positions.Single(row => row.GetProperty("ean13").GetString() == "1234567890128");
        Assert.Equal(0, outOfStock.GetProperty("physicalQuantity").GetInt32());
        Assert.Equal("OUT_OF_STOCK", outOfStock.GetProperty("availability").GetString());
        Assert.Null(outOfStock.GetProperty("reason").GetString());

        var expired = positions.Single(row => row.GetProperty("ean13").GetString() == "4006381333931");
        Assert.Equal(7, expired.GetProperty("physicalQuantity").GetInt32());
        Assert.Equal(0, expired.GetProperty("sellableQuantity").GetInt32());
        Assert.Equal("NOT_SELLABLE", expired.GetProperty("availability").GetString());
        Assert.Equal("DLC_EXPIRED", expired.GetProperty("reason").GetString());

        var archived = positions.Single(row => row.GetProperty("ean13").GetString() == "7351353713578");
        Assert.Equal(4, archived.GetProperty("physicalQuantity").GetInt32());
        Assert.Equal("ARCHIVED", archived.GetProperty("reason").GetString());

        var unsellable = positions.Single(row => row.GetProperty("ean13").GetString() == "5901234123457");
        Assert.Equal(3, unsellable.GetProperty("physicalQuantity").GetInt32());
        Assert.Equal("UNSELLABLE_PACKAGING", unsellable.GetProperty("reason").GetString());
        Assert.False(unsellable.TryGetProperty("dlc", out _));

        using var detail = await client.GetAsync("/api/stock/0123456789012");
        Assert.Equal(HttpStatusCode.OK, detail.StatusCode);
        using var detailBody = JsonDocument.Parse(await detail.Content.ReadAsStringAsync());
        Assert.Equal(available.GetProperty("ean13").GetString(), detailBody.RootElement.GetProperty("ean13").GetString());
        Assert.Equal(available.GetProperty("physicalQuantity").GetInt32(), detailBody.RootElement.GetProperty("physicalQuantity").GetInt32());
        Assert.Equal(available.GetProperty("sellableQuantity").GetInt32(), detailBody.RootElement.GetProperty("sellableQuantity").GetInt32());

        factory.SetNow(day.AddDays(1));
        using var nextDay = await client.GetAsync("/api/stock");
        using var nextDayBody = JsonDocument.Parse(await nextDay.Content.ReadAsStringAsync());
        var expiredOnNextDay = nextDayBody.RootElement
            .EnumerateArray()
            .Single(row => row.GetProperty("ean13").GetString() == "0123456789012");
        Assert.Equal(5, expiredOnNextDay.GetProperty("physicalQuantity").GetInt32());
        Assert.Equal(0, expiredOnNextDay.GetProperty("sellableQuantity").GetInt32());
        Assert.Equal("NOT_SELLABLE", expiredOnNextDay.GetProperty("availability").GetString());
        Assert.Equal("DLC_EXPIRED", expiredOnNextDay.GetProperty("reason").GetString());
        Assert.Equal(0, await CountStockPositionsAsync(factory.Services, "1234567890128"));

        using var malformed = await client.GetAsync("/api/stock/123");
        Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
        Assert.Equal("application/problem+json", malformed.Content.Headers.ContentType?.MediaType);
        using var malformedBody = JsonDocument.Parse(await malformed.Content.ReadAsStringAsync());
        Assert.Equal("stock.validation", malformedBody.RootElement.GetProperty("code").GetString());
        Assert.True(malformedBody.RootElement.GetProperty("errors").TryGetProperty("ean13", out _));

        using var unknown = await client.GetAsync("/api/stock/9876543210982");
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal("application/problem+json", unknown.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Refuses_direct_attribute_patch_of_an_archived_article()
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();
        using var create = await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "4006381333931",
            type = "nonFood",
            name = "Batterie",
            priceHtCents = 2500,
            packaging = "new"
        });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        using var archive = await client.PostAsync("/api/articles/4006381333931/archive", null);
        Assert.Equal(HttpStatusCode.OK, archive.StatusCode);

        using var patch = await client.PatchAsJsonAsync("/api/articles/4006381333931", new { name = "Batterie archivée" });
        Assert.Equal(HttpStatusCode.Conflict, patch.StatusCode);
        Assert.Equal("application/problem+json", patch.Content.Headers.ContentType?.MediaType);
        using var problem = JsonDocument.Parse(await patch.Content.ReadAsStringAsync());
        Assert.Equal("article.update.archived", problem.RootElement.GetProperty("code").GetString());
        Assert.True(problem.RootElement.GetProperty("errors").TryGetProperty("status", out _));

        using var read = await client.GetAsync("/api/articles/4006381333931");
        using var loaded = JsonDocument.Parse(await read.Content.ReadAsStringAsync());
        Assert.Equal("Batterie", loaded.RootElement.GetProperty("name").GetString());
        Assert.Equal("archived", loaded.RootElement.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Concurrent_attribute_patches_produce_one_success_one_conflict_and_one_fact()
    {
        using var factory = new ArticleHostFactory();
        using var setupClient = factory.CreateClient();
        using var create = await setupClient.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "0123456789012",
            type = "food",
            name = "Chocolat noir",
            priceHtCents = 199,
            dlc = "2026-12-31",
            consumptionModes = new[] { "takeaway" }
        });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);

        using var firstClient = factory.CreateClient();
        using var secondClient = factory.CreateClient();
        var responses = await Task.WhenAll(
            firstClient.PatchAsJsonAsync("/api/articles/0123456789012", new { name = "Chocolat bio" }),
            secondClient.PatchAsJsonAsync("/api/articles/0123456789012", new { name = "Chocolat noir intense" }));

        Assert.Equal(1, responses.Count(response => response.StatusCode == HttpStatusCode.OK));
        Assert.Equal(1, responses.Count(response => response.StatusCode == HttpStatusCode.Conflict));
        foreach (var response in responses)
        {
            Assert.Equal(
                response.StatusCode == HttpStatusCode.OK ? "application/json" : "application/problem+json",
                response.Content.Headers.ContentType?.MediaType);
            response.Dispose();
        }

        using var history = await setupClient.GetAsync("/api/history?ean13=0123456789012");
        using var body = JsonDocument.Parse(await history.Content.ReadAsStringAsync());
        Assert.Single(body.RootElement.EnumerateArray());
        Assert.Equal("attributes", body.RootElement[0].GetProperty("kind").GetString());
    }

    [Fact]
    public async Task Rejects_derived_price_input_and_keeps_the_old_price()
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();
        using var create = await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "7351353713578",
            type = "nonFood",
            name = "Batterie",
            priceHtCents = 1000,
            packaging = "new"
        });

        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        using var patchRequest = new HttpRequestMessage(HttpMethod.Patch, "/api/articles/7351353713578")
        {
            Content = JsonContent.Create(new { priceTtcCents = 1200 })
        };
        using var patch = await client.SendAsync(patchRequest);

        Assert.Equal(HttpStatusCode.BadRequest, patch.StatusCode);
        Assert.Equal("application/problem+json", patch.Content.Headers.ContentType?.MediaType);
        using var problem = JsonDocument.Parse(await patch.Content.ReadAsStringAsync());
        Assert.Equal("article.validation", problem.RootElement.GetProperty("code").GetString());
        Assert.True(problem.RootElement.GetProperty("errors").TryGetProperty("priceTtcCents", out _));

        using var read = await client.GetAsync("/api/articles/7351353713578");
        using var loaded = JsonDocument.Parse(await read.Content.ReadAsStringAsync());
        Assert.Equal(1000, loaded.RootElement.GetProperty("priceHtCents").GetInt32());
    }

    [Theory]
    [InlineData("{}", "priceHtCents")]
    [InlineData("{\"priceHtCents\":null}", "priceHtCents")]
    [InlineData("{\"priceHtCents\":\"199\"}", "priceHtCents")]
    [InlineData("{\"priceHtCents\":199.0}", "priceHtCents")]
    [InlineData("{\"priceTtcCents\":1200}", "priceTtcCents")]
    public async Task Rejects_invalid_patch_shapes_without_mutating_the_article(string json, string field)
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();
        using var create = await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "7351353713578",
            type = "nonFood",
            name = "Batterie",
            priceHtCents = 1000,
            packaging = "new"
        });

        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        using var patchRequest = new HttpRequestMessage(HttpMethod.Patch, "/api/articles/7351353713578")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
        using var patch = await client.SendAsync(patchRequest);

        Assert.Equal(HttpStatusCode.BadRequest, patch.StatusCode);
        using var problem = JsonDocument.Parse(await patch.Content.ReadAsStringAsync());
        Assert.True(problem.RootElement.GetProperty("errors").TryGetProperty(field, out _));

        using var read = await client.GetAsync("/api/articles/7351353713578");
        using var loaded = JsonDocument.Parse(await read.Content.ReadAsStringAsync());
        Assert.Equal(1000, loaded.RootElement.GetProperty("priceHtCents").GetInt32());
    }

    [Fact]
    public async Task Patching_an_unknown_article_returns_not_found_problem_details()
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();
        using var patchRequest = new HttpRequestMessage(HttpMethod.Patch, "/api/articles/4006381333931")
        {
            Content = JsonContent.Create(new { priceHtCents = 199 })
        };

        using var response = await client.SendAsync(patchRequest);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("article.not_found", body.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Patching_an_archived_article_returns_conflict_without_mutating_persisted_price()
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();
        using var create = await client.PostAsJsonAsync("/api/articles", new
        {
            ean13 = "7351353713578",
            type = "nonFood",
            name = "Batterie",
            priceHtCents = 1000,
            packaging = "new"
        });

        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        await SetArticleArchivedAsync(factory, "7351353713578");

        using var patchRequest = new HttpRequestMessage(HttpMethod.Patch, "/api/articles/7351353713578")
        {
            Content = JsonContent.Create(new { priceHtCents = 199 })
        };
        using var patch = await client.SendAsync(patchRequest);

        Assert.Equal(HttpStatusCode.Conflict, patch.StatusCode);
        Assert.Equal("application/problem+json", patch.Content.Headers.ContentType?.MediaType);
        using var problem = JsonDocument.Parse(await patch.Content.ReadAsStringAsync());
        Assert.Equal("article.priceHt.conflict", problem.RootElement.GetProperty("code").GetString());
        Assert.True(problem.RootElement.GetProperty("errors").TryGetProperty("priceHtCents", out _));

        var state = await ReadArticleStateAsync(factory, "7351353713578");
        Assert.False(state.IsActive);
        Assert.Equal(1000, state.PriceHtCents);
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
    public async Task Real_store_maps_a_stale_price_version_to_a_conflict()
    {
        using var factory = new ArticleHostFactory();
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
        var firstRead = await store.FindByEanAsync(article.Ean13);
        var staleRead = await store.FindByEanAsync(article.Ean13);
        Assert.NotNull(firstRead);
        Assert.NotNull(staleRead);
        firstRead!.ChangePriceHt(Money.FromCents(2600));
        staleRead!.ChangePriceHt(Money.FromCents(2700));

        Assert.Equal(ArticleStoreUpdateStatus.Updated, await store.UpdatePriceHtAsync(firstRead));
        Assert.Equal(ArticleStoreUpdateStatus.Conflict, await store.UpdatePriceHtAsync(staleRead));
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
    public async Task Archives_reactivates_and_persists_the_same_article_and_lifecycle_history()
    {
        using var factory = new ArticleHostFactory();
        using var client = factory.CreateClient();
        const string ean13 = "0123456789012";
        var payload = new
        {
            ean13,
            type = "food",
            name = "Chocolat noir",
            priceHtCents = 199,
            dlc = "2026-12-31",
            consumptionModes = new[] { "takeaway" }
        };

        using var create = await client.PostAsJsonAsync("/api/articles", payload);
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);

        using var archive = await client.PostAsync($"/api/articles/{ean13}/archive", null);
        Assert.Equal(HttpStatusCode.OK, archive.StatusCode);
        using var archivedBody = JsonDocument.Parse(await archive.Content.ReadAsStringAsync());
        Assert.False(archivedBody.RootElement.GetProperty("isActive").GetBoolean());
        Assert.Equal("archived", archivedBody.RootElement.GetProperty("status").GetString());
        Assert.Equal(ean13, archivedBody.RootElement.GetProperty("ean13").GetString());
        Assert.Equal(199, archivedBody.RootElement.GetProperty("priceHtCents").GetInt32());

        using var active = await client.GetAsync("/api/articles");
        using var archived = await client.GetAsync("/api/articles?status=archived");
        Assert.DoesNotContain(ean13, await active.Content.ReadAsStringAsync());
        Assert.Contains(ean13, await archived.Content.ReadAsStringAsync());

        using var firstHistory = await client.GetAsync($"/api/history?ean13={ean13}");
        Assert.Equal(HttpStatusCode.OK, firstHistory.StatusCode);
        using var firstHistoryBody = JsonDocument.Parse(await firstHistory.Content.ReadAsStringAsync());
        var archiveFact = Assert.Single(firstHistoryBody.RootElement.EnumerateArray());
        Assert.Equal("active", archiveFact.GetProperty("previousStatus").GetString());
        Assert.Equal("archived", archiveFact.GetProperty("nextStatus").GetString());
        Assert.Equal(ean13, archiveFact.GetProperty("ean13").GetString());

        using var reuseArchived = await client.PostAsJsonAsync("/api/articles", payload);
        Assert.Equal(HttpStatusCode.Conflict, reuseArchived.StatusCode);
        using var reuseArchivedBody = JsonDocument.Parse(await reuseArchived.Content.ReadAsStringAsync());
        Assert.Equal("article.ean13.conflict", reuseArchivedBody.RootElement.GetProperty("code").GetString());

        using var reactivate = await client.PostAsync($"/api/articles/{ean13}/reactivate", null);
        Assert.Equal(HttpStatusCode.OK, reactivate.StatusCode);
        using var reactivatedBody = JsonDocument.Parse(await reactivate.Content.ReadAsStringAsync());
        Assert.True(reactivatedBody.RootElement.GetProperty("isActive").GetBoolean());
        Assert.Equal("active", reactivatedBody.RootElement.GetProperty("status").GetString());
        Assert.Equal(ean13, reactivatedBody.RootElement.GetProperty("ean13").GetString());
        Assert.Equal(199, reactivatedBody.RootElement.GetProperty("priceHtCents").GetInt32());

        using var all = await client.GetAsync("/api/articles?status=all");
        Assert.Contains(ean13, await all.Content.ReadAsStringAsync());

        using var secondHistory = await client.GetAsync($"/api/history?ean13={ean13}");
        using var secondHistoryBody = JsonDocument.Parse(await secondHistory.Content.ReadAsStringAsync());
        Assert.Equal(2, secondHistoryBody.RootElement.GetArrayLength());
        Assert.Equal("archived", secondHistoryBody.RootElement[1].GetProperty("previousStatus").GetString());
        Assert.Equal("active", secondHistoryBody.RootElement[1].GetProperty("nextStatus").GetString());

        using var repeated = await client.PostAsync($"/api/articles/{ean13}/reactivate", null);
        Assert.Equal(HttpStatusCode.Conflict, repeated.StatusCode);
        Assert.Equal("application/problem+json", repeated.Content.Headers.ContentType?.MediaType);
        using var repeatedBody = JsonDocument.Parse(await repeated.Content.ReadAsStringAsync());
        Assert.Equal("article.lifecycle.already_active", repeatedBody.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Concurrent_archives_produce_one_success_one_conflict_and_one_history_fact()
    {
        using var factory = new ArticleHostFactory();
        using var setupClient = factory.CreateClient();
        const string ean13 = "7351353713578";

        using var create = await setupClient.PostAsJsonAsync("/api/articles", new
        {
            ean13,
            type = "nonFood",
            name = "Batterie",
            priceHtCents = 2500,
            packaging = "new"
        });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);

        using var firstClient = factory.CreateClient();
        using var secondClient = factory.CreateClient();
        var responses = await Task.WhenAll(
            firstClient.PostAsync($"/api/articles/{ean13}/archive", null),
            secondClient.PostAsync($"/api/articles/{ean13}/archive", null));
        try
        {
            Assert.Equal(1, responses.Count(response => response.StatusCode == HttpStatusCode.OK));
            Assert.Equal(1, responses.Count(response => response.StatusCode == HttpStatusCode.Conflict));
        }
        finally
        {
            foreach (var response in responses)
            {
                response.Dispose();
            }
        }

        using var history = await setupClient.GetAsync($"/api/history?ean13={ean13}");
        using var historyBody = JsonDocument.Parse(await history.Content.ReadAsStringAsync());
        Assert.Equal(1, historyBody.RootElement.GetArrayLength());
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

        using var activeBody = JsonDocument.Parse(await active.Content.ReadAsStringAsync());
        foreach (var article in activeBody.RootElement.EnumerateArray())
        {
            Assert.False(article.TryGetProperty("priceQuotes", out _));
            Assert.False(article.TryGetProperty("priceTtcCents", out _));
            Assert.False(article.TryGetProperty("vatCents", out _));
        }

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
            name = "CAFÉ aux deux modes",
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

        using var nameSearch = await client.GetAsync("/api/articles?search=%20caf%C3%A9%20");
        using var eanSearch = await client.GetAsync("/api/articles?search=0123456789012");
        using var emptySearch = await client.GetAsync("/api/articles?search=%20%20");
        using var takeaway = await client.GetAsync("/api/articles?mode=takeaway");
        using var onsiteFood = await client.GetAsync("/api/articles?type=food&mode=onsite");
        using var newPackaging = await client.GetAsync("/api/articles?packaging=new");
        using var incompatible = await client.GetAsync("/api/articles?type=food&packaging=new");
        using var opposite = await client.GetAsync("/api/articles?type=nonFood&mode=takeaway");

        Assert.Equal(["CAFÉ aux deux modes"], await ReadNames(nameSearch));
        Assert.Equal(["Biscuit à emporter"], await ReadNames(eanSearch));
        Assert.Equal(5, (await ReadNames(emptySearch)).Count);
        Assert.Equal(["Biscuit à emporter", "CAFÉ aux deux modes"], await ReadNames(takeaway));
        Assert.Equal(["CAFÉ aux deux modes", "Plat sur place"], await ReadNames(onsiteFood));
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

    [Fact]
    public async Task Unexpected_stock_read_failure_returns_sanitized_problem_details()
    {
        using var factory = new FailingStoreHostFactory();
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/api/stock");

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
                NameSearchKey = "BISCUIT HISTORIQUE",
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
                NameSearchKey = "LAMPE HISTORIQUE",
                PriceHtCents = 2900,
                IsActive = false,
                Packaging = "refurbished"
            });
        await context.SaveChangesAsync();
    }

    private static async Task SeedStockPositionAsync(IServiceProvider services, string ean13, int physicalQuantity)
    {
        using var scope = services.CreateScope();
        var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
        await using var context = await contextFactory.CreateDbContextAsync();
        context.StockPositions.Add(new StockPositionEntity
        {
            Ean13 = ean13,
            PhysicalQuantity = physicalQuantity
        });
        await context.SaveChangesAsync();
    }

    private static async Task<int> CountStockPositionsAsync(IServiceProvider services, string ean13)
    {
        using var scope = services.CreateScope();
        var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
        await using var context = await contextFactory.CreateDbContextAsync();
        return await context.StockPositions.CountAsync(position => position.Ean13 == ean13);
    }

    private sealed class ArticleHostFactory : WebApplicationFactory<Program>
    {
        private readonly string databasePath = Path.Combine(Path.GetTempPath(), $"token-warehouse-article-{Guid.NewGuid():N}.db");
        private readonly CultureInfo? requestCulture;
        private readonly MutableClock? fixedClock;

        public ArticleHostFactory(CultureInfo? requestCulture = null, DateTimeOffset? fixedNow = null)
        {
            this.requestCulture = requestCulture;
            fixedClock = fixedNow is { } now ? new MutableClock(now) : null;
        }

        public void SetNow(DateTimeOffset now)
            => (fixedClock ?? throw new InvalidOperationException("A fixed clock is required.")).Now = now;

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:Warehouse", $"Data Source={databasePath}");
            if (requestCulture is not null)
            {
                builder.ConfigureServices(services =>
                    services.AddSingleton<IStartupFilter>(new RequestCultureStartupFilter(requestCulture)));
            }

            if (fixedClock is not null)
            {
                builder.ConfigureServices(services =>
                {
                    services.RemoveAll<IClock>();
                    services.AddSingleton<IClock>(fixedClock);
                });
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

    private sealed class MutableClock(DateTimeOffset now) : IClock
    {
        public DateTimeOffset Now { get; set; } = now;

        public DateTimeOffset UtcNow => Now;
    }

    private static async Task SetArticleArchivedAsync(ArticleHostFactory factory, string ean13)
    {
        using var scope = factory.Services.CreateScope();
        var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
        await using var context = await contextFactory.CreateDbContextAsync();
        var entity = await context.Articles.SingleAsync(article => article.Ean13 == ean13);
        entity.IsActive = false;
        await context.SaveChangesAsync();
    }

    private static async Task<(int PriceHtCents, bool IsActive)> ReadArticleStateAsync(
        ArticleHostFactory factory,
        string ean13)
    {
        using var scope = factory.Services.CreateScope();
        var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
        await using var context = await contextFactory.CreateDbContextAsync();
        var entity = await context.Articles
            .AsNoTracking()
            .SingleAsync(article => article.Ean13 == ean13);
        return (entity.PriceHtCents, entity.IsActive);
    }

    private static async Task PersistSaleSnapshotAsync(ArticleHostFactory factory, SaleSnapshot snapshot)
    {
        using var scope = factory.Services.CreateScope();
        var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
        await using var context = await contextFactory.CreateDbContextAsync();
        await context.Database.OpenConnectionAsync();

        await using var create = context.Database.GetDbConnection().CreateCommand();
        create.CommandText = """
            CREATE TABLE SaleSnapshots (
                Id INTEGER PRIMARY KEY,
                ArticleEan13 TEXT NOT NULL,
                SaleContext TEXT NOT NULL,
                UnitPriceHtCents INTEGER NOT NULL,
                Quantity INTEGER NOT NULL,
                AmountHtCents INTEGER NOT NULL,
                VatCents INTEGER NOT NULL,
                AmountTtcCents INTEGER NOT NULL,
                FOREIGN KEY (ArticleEan13) REFERENCES Articles (Ean13)
            )
            """;
        await create.ExecuteNonQueryAsync();

        await using var insert = context.Database.GetDbConnection().CreateCommand();
        insert.CommandText = """
            INSERT INTO SaleSnapshots
                (Id, ArticleEan13, SaleContext, UnitPriceHtCents, Quantity, AmountHtCents, VatCents, AmountTtcCents)
            VALUES (1, $articleEan13, $saleContext, $unitPriceHtCents, $quantity, $amountHtCents, $vatCents, $amountTtcCents)
            """;
        AddParameter(insert, "$articleEan13", snapshot.ArticleEan13);
        AddParameter(insert, "$saleContext", snapshot.SaleContext);
        AddParameter(insert, "$unitPriceHtCents", snapshot.UnitPriceHtCents);
        AddParameter(insert, "$quantity", snapshot.Quantity);
        AddParameter(insert, "$amountHtCents", snapshot.AmountHtCents);
        AddParameter(insert, "$vatCents", snapshot.VatCents);
        AddParameter(insert, "$amountTtcCents", snapshot.AmountTtcCents);
        await insert.ExecuteNonQueryAsync();
    }

    private static async Task<SaleSnapshot> ReadSaleSnapshotAsync(ArticleHostFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
        await using var context = await contextFactory.CreateDbContextAsync();
        await context.Database.OpenConnectionAsync();

        await using var select = context.Database.GetDbConnection().CreateCommand();
        select.CommandText = """
            SELECT ArticleEan13, SaleContext, UnitPriceHtCents, Quantity, AmountHtCents, VatCents, AmountTtcCents
            FROM SaleSnapshots
            WHERE Id = 1
            """;
        await using var reader = await select.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        return new SaleSnapshot(
            reader.GetString(0),
            reader.GetString(1),
            reader.GetInt32(2),
            reader.GetInt32(3),
            reader.GetInt32(4),
            reader.GetInt32(5),
            reader.GetInt32(6));
    }

    private static void AddParameter(DbCommand command, string name, object value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value;
        command.Parameters.Add(parameter);
    }

    private sealed record SaleSnapshot(
        string ArticleEan13,
        string SaleContext,
        int UnitPriceHtCents,
        int Quantity,
        int AmountHtCents,
        int VatCents,
        int AmountTtcCents);

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

        public ValueTask<ArticleStoreLifecycleTransitionStatus> TransitionLifecycleAsync(
            Ean13 ean13,
            ArticleLifecycleStatus expectedStatus,
            ArticleLifecycleStatus targetStatus,
            ArticleLifecycleHistory history,
            CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("database internals");

        public ValueTask<IReadOnlyList<ArticleLifecycleHistory>> ListLifecycleHistoryAsync(
            Ean13? ean13 = null,
            CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("database internals");

        public ValueTask<ArticleStoreAttributeUpdateStatus> UpdateAttributesAsync(
            Article article,
            ArticleAttributeHistory history,
            CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("database internals");

        public ValueTask<IReadOnlyList<ArticleAttributeHistory>> ListAttributeHistoryAsync(
            Ean13? ean13 = null,
            CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("database internals");

        public ValueTask<ArticleStorePriceUpdateCandidate> FindForPriceUpdateAsync(
            Ean13 ean13,
            CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("database internals");

        public ValueTask<ArticleStoreUpdateStatus> UpdatePriceHtAsync(
            Article article,
            CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("database internals");
    }
}
