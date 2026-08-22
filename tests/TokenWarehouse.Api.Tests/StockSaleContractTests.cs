using System.Text.Json;
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;
using TokenWarehouse.Infrastructure.Persistence;
using Xunit;

namespace TokenWarehouse.Api.Tests;

public sealed class StockSaleContractTests
{
    private static readonly DateTimeOffset Now =
        new(2030, 1, 15, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Commits_a_sale_atomically_and_reloads_it_from_sqlite()
    {
        using var factory = new HostFactory(Now);
        using var client = factory.CreateClient();
        await factory.SeedAsync();

        using var scope = factory.Services.CreateScope();
        var contract = scope.ServiceProvider.GetRequiredService<IStockSaleContract>();
        var participant = new SentinelParticipantPersistenceAdapter(
            "financial-sentinel",
            "{\"saleId\":\"sentinel-1\",\"amountHtCents\":303}");
        var result = await contract.RecordAsync(new StockSaleCommand
        {
            Ean13 = "0123456789012",
            Quantity = 3
        }, participant);

        Assert.Equal(StockSaleStatus.Committed, result.Status);
        Assert.True(participant.Staged);
        Assert.Equal(result.Receipt?.Operation.Id, participant.OperationId);
        Assert.Equal(-3, result.Receipt?.Operation.Lines.Single().StockEffect);
        Assert.Equal(5, result.Receipt?.Position.PhysicalQuantity);

        var state = await factory.ReadFreshAsync(async context => new
        {
            Operation = await context.StockOperations
                .AsNoTracking()
                .Include(operation => operation.Lines)
                .SingleAsync(operation => operation.Type == "SALE"),
            Position = await context.StockPositions
                .AsNoTracking()
                .SingleAsync(position => position.Ean13 == "0123456789012")
        });
        Assert.Equal(3, state.Operation.Quantity);
        Assert.Equal("0123456789012", state.Operation.Ean13);
        Assert.Equal(-3, state.Operation.Lines.Single().SourceEffect);
        Assert.Equal("financial-sentinel", state.Operation.SaleCommitDataType);
        Assert.Equal(
            "{\"saleId\":\"sentinel-1\",\"amountHtCents\":303}",
            state.Operation.SaleCommitDataPayload);
        Assert.Equal(5, state.Position.PhysicalQuantity);

        var beforeReads = await factory.ReadFreshAsync(async context => new
        {
            Operations = await context.StockOperations.CountAsync(),
            Positions = await context.StockPositions.CountAsync()
        });
        var positions = await scope.ServiceProvider
            .GetRequiredService<IStockPositionReadContract>()
            .ListAsync();
        var operations = await scope.ServiceProvider
            .GetRequiredService<IStockOperationReadContract>()
            .ListAsync();
        var repeatedOperations = await scope.ServiceProvider
            .GetRequiredService<IStockOperationReadContract>()
            .ListAsync();
        var afterReads = await factory.ReadFreshAsync(async context => new
        {
            Operations = await context.StockOperations.CountAsync(),
            Positions = await context.StockPositions.CountAsync()
        });
        Assert.Equal(StockReadStatus.Success, positions.Status);
        Assert.Equal(5, positions.Positions.Single().PhysicalQuantity);
        Assert.Equal(StockOperationReadStatus.Success, operations.Status);
        Assert.Single(operations.Operations);
        Assert.Equal("SALE", operations.Operations[0].Type.ToString().ToUpperInvariant());
        Assert.Equal(-3, operations.Operations[0].Lines.Single().StockEffect);
        Assert.Equal(
            operations.Operations.Select(operation => operation.Id),
            repeatedOperations.Operations.Select(operation => operation.Id));
        Assert.Equal(beforeReads, afterReads);

    }

    [Fact]
    public async Task Creates_a_sale_with_a_server_financial_snapshot_and_reads_it_back()
    {
        using var factory = new HostFactory(Now);
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync(
            "7351353713578",
            "Batterie industrielle",
            type: "nonFood",
            packaging: "new",
            physicalQuantity: 8,
            priceHtCents: 101);

        using var response = await client.PostAsJsonAsync(
            "/api/sales",
            new { ean13 = "7351353713578", quantity = 3 });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var operationId = body.GetProperty("operation").GetProperty("id").GetString();
        Assert.False(string.IsNullOrWhiteSpace(operationId));
        Assert.Equal("SALE", body.GetProperty("operation").GetProperty("type").GetString());
        Assert.Equal("7351353713578", body.GetProperty("operation").GetProperty("ean13").GetString());
        Assert.Equal(3, body.GetProperty("operation").GetProperty("quantity").GetInt32());
        Assert.Equal(101, body.GetProperty("financial").GetProperty("unitPriceHtCents").GetInt32());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("financial").GetProperty("context").ValueKind);
        Assert.Equal("nonFood", body.GetProperty("financial").GetProperty("taxRate").GetProperty("code").GetString());
        Assert.Equal(303, body.GetProperty("financial").GetProperty("amountHtCents").GetInt32());
        Assert.Equal(61, body.GetProperty("financial").GetProperty("vatCents").GetInt32());
        Assert.Equal(364, body.GetProperty("financial").GetProperty("amountTtcCents").GetInt32());
        Assert.Equal(5, body.GetProperty("position").GetProperty("physicalQuantity").GetInt32());
        Assert.Equal(5, body.GetProperty("position").GetProperty("sellableQuantity").GetInt32());

        using var priceUpdate = await client.PatchAsJsonAsync(
            "/api/articles/7351353713578",
            new { priceHtCents = 999 });
        Assert.Equal(HttpStatusCode.OK, priceUpdate.StatusCode);

        using var readBack = await client.GetAsync($"/api/sales/{operationId}");
        Assert.Equal(HttpStatusCode.OK, readBack.StatusCode);
        var readBody = await readBack.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(101, readBody.GetProperty("financial").GetProperty("unitPriceHtCents").GetInt32());
        Assert.Equal(303, readBody.GetProperty("financial").GetProperty("amountHtCents").GetInt32());
        Assert.Equal(5, readBody.GetProperty("position").GetProperty("physicalQuantity").GetInt32());
        Assert.Equal(operationId, readBody.GetProperty("operation").GetProperty("id").GetString());
        Assert.Equal(
            1,
            await factory.ReadFreshAsync(context => context.StockOperations.CountAsync(operation => operation.Type == "SALE")));
    }

    [Fact]
    public async Task Persists_the_financial_snapshot_as_metadata_of_the_same_stock_operation()
    {
        using var factory = new HostFactory(Now);
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync(
            "0123456789012",
            "Chocolat à emporter",
            dlc: "2030-01-15",
            physicalQuantity: 5,
            priceHtCents: 99,
            consumptionModes: "takeaway");

        using var response = await client.PostAsJsonAsync(
            "/api/sales",
            new { ean13 = "0123456789012", quantity = 2 });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var operation = body.GetProperty("operation");
        var operationId = operation.GetProperty("id").GetString();
        Assert.False(string.IsNullOrWhiteSpace(operationId));
        Assert.Equal("SALE", operation.GetProperty("type").GetString());
        Assert.Equal("0123456789012", operation.GetProperty("ean13").GetString());
        Assert.Equal(2, operation.GetProperty("quantity").GetInt32());
        Assert.Equal(Now, operation.GetProperty("occurredAt").GetDateTimeOffset());
        var financial = body.GetProperty("financial");
        Assert.Equal("takeaway", financial.GetProperty("context").GetString());
        Assert.Equal(99, financial.GetProperty("unitPriceHtCents").GetInt32());
        var taxRate = financial.GetProperty("taxRate");
        Assert.Equal("takeaway", taxRate.GetProperty("code").GetString());
        Assert.Equal("11/200", taxRate.GetProperty("ratio").GetString());
        Assert.Equal(11, taxRate.GetProperty("numerator").GetInt32());
        Assert.Equal(200, taxRate.GetProperty("denominator").GetInt32());
        Assert.Equal(198, financial.GetProperty("amountHtCents").GetInt32());
        Assert.Equal(11, financial.GetProperty("vatCents").GetInt32());
        Assert.Equal(209, financial.GetProperty("amountTtcCents").GetInt32());
        Assert.Equal(3, body.GetProperty("position").GetProperty("physicalQuantity").GetInt32());

        using var priceUpdate = await client.PatchAsJsonAsync(
            "/api/articles/0123456789012",
            new { priceHtCents = 999 });
        Assert.Equal(HttpStatusCode.OK, priceUpdate.StatusCode);

        using var reloadedClient = factory.CreateClient();
        using var readBack = await reloadedClient.GetAsync($"/api/sales/{operationId}");
        Assert.Equal(HttpStatusCode.OK, readBack.StatusCode);
        var readBody = await readBack.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(operationId, readBody.GetProperty("operation").GetProperty("id").GetString());
        Assert.Equal("0123456789012", readBody.GetProperty("operation").GetProperty("ean13").GetString());
        Assert.Equal(2, readBody.GetProperty("operation").GetProperty("quantity").GetInt32());
        Assert.Equal(Now, readBody.GetProperty("operation").GetProperty("occurredAt").GetDateTimeOffset());
        var readFinancial = readBody.GetProperty("financial");
        Assert.Equal("takeaway", readFinancial.GetProperty("context").GetString());
        Assert.Equal(99, readFinancial.GetProperty("unitPriceHtCents").GetInt32());
        Assert.Equal("takeaway", readFinancial.GetProperty("taxRate").GetProperty("code").GetString());
        Assert.Equal(11, readFinancial.GetProperty("taxRate").GetProperty("numerator").GetInt32());
        Assert.Equal(200, readFinancial.GetProperty("taxRate").GetProperty("denominator").GetInt32());
        Assert.Equal(198, readFinancial.GetProperty("amountHtCents").GetInt32());
        Assert.Equal(11, readFinancial.GetProperty("vatCents").GetInt32());
        Assert.Equal(209, readFinancial.GetProperty("amountTtcCents").GetInt32());
        Assert.Equal(3, readBody.GetProperty("position").GetProperty("physicalQuantity").GetInt32());

        using var history = await reloadedClient.GetAsync("/api/history?ean13=0123456789012");
        Assert.Equal(HttpStatusCode.OK, history.StatusCode);
        var historyBody = await history.Content.ReadFromJsonAsync<JsonElement>();
        var saleHistory = historyBody.EnumerateArray()
            .Single(entry => entry.GetProperty("id").GetString() == operationId);
        Assert.Equal("SALE_STOCK", saleHistory.GetProperty("type").GetString());
        Assert.Equal(2, saleHistory.GetProperty("quantity").GetInt32());
        Assert.Equal(-2, saleHistory.GetProperty("stockEffect").GetInt32());
    }

    [Fact]
    public async Task Rejects_sale_edit_and_delete_at_public_and_persistence_boundaries()
    {
        using var factory = new HostFactory(Now);
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync(
            "7351353713578",
            "Batterie industrielle",
            type: "nonFood",
            packaging: "new",
            physicalQuantity: 8,
            priceHtCents: 101);

        using var created = await client.PostAsJsonAsync(
            "/api/sales",
            new { ean13 = "7351353713578", quantity = 3 });
        var createdBody = await created.Content.ReadFromJsonAsync<JsonElement>();
        var operationId = createdBody.GetProperty("operation").GetProperty("id").GetString();
        Assert.False(string.IsNullOrWhiteSpace(operationId));

        using var beforeResponse = await client.GetAsync($"/api/sales/{operationId}");
        var before = await beforeResponse.Content.ReadFromJsonAsync<JsonElement>();
        foreach (var method in new[] { HttpMethod.Patch, HttpMethod.Put, HttpMethod.Delete })
        {
            using var request = new HttpRequestMessage(method, $"/api/sales/{operationId}");
            if (method != HttpMethod.Delete)
            {
                request.Content = JsonContent.Create(new
                {
                    financial = new { amountHtCents = 1 },
                    occurredAt = "2030-01-15T10:00:00Z"
                });
            }

            using var response = await client.SendAsync(request);
            Assert.False(response.IsSuccessStatusCode);
        }

        await Assert.ThrowsAsync<DbUpdateException>(() => factory.ReadFreshAsync(async context =>
        {
            var operation = await context.StockOperations.SingleAsync(candidate => candidate.Id == operationId);
            operation.SaleFinancialAmountHtCents++;
            await context.SaveChangesAsync();
            return true;
        }));

        await Assert.ThrowsAsync<DbUpdateException>(() => factory.ReadFreshAsync(async context =>
        {
            var operation = await context.StockOperations.SingleAsync(candidate => candidate.Id == operationId);
            context.StockOperations.Remove(operation);
            await context.SaveChangesAsync();
            return true;
        }));

        using var afterResponse = await client.GetAsync($"/api/sales/{operationId}");
        var after = await afterResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(
            before.GetProperty("operation").GetProperty("id").GetString(),
            after.GetProperty("operation").GetProperty("id").GetString());
        Assert.Equal(
            before.GetProperty("operation").GetProperty("occurredAt").GetDateTimeOffset(),
            after.GetProperty("operation").GetProperty("occurredAt").GetDateTimeOffset());
        Assert.Equal(
            before.GetProperty("financial").GetProperty("unitPriceHtCents").GetInt32(),
            after.GetProperty("financial").GetProperty("unitPriceHtCents").GetInt32());
        Assert.Equal(
            before.GetProperty("financial").GetProperty("amountHtCents").GetInt32(),
            after.GetProperty("financial").GetProperty("amountHtCents").GetInt32());
        Assert.Equal(
            before.GetProperty("financial").GetProperty("vatCents").GetInt32(),
            after.GetProperty("financial").GetProperty("vatCents").GetInt32());
        Assert.Equal(
            before.GetProperty("financial").GetProperty("amountTtcCents").GetInt32(),
            after.GetProperty("financial").GetProperty("amountTtcCents").GetInt32());
        Assert.Equal(
            before.GetProperty("position").GetProperty("physicalQuantity").GetInt32(),
            after.GetProperty("position").GetProperty("physicalQuantity").GetInt32());
    }

    [Fact]
    public async Task Reads_each_sale_snapshot_after_a_later_sale_and_sellability_change()
    {
        using var factory = new HostFactory(Now);
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync(
            "7351353713578",
            "Batterie industrielle",
            type: "nonFood",
            packaging: "new",
            physicalQuantity: 8,
            priceHtCents: 101);

        using var firstResponse = await client.PostAsJsonAsync(
            "/api/sales",
            new { ean13 = "7351353713578", quantity = 3 });
        var firstBody = await firstResponse.Content.ReadFromJsonAsync<JsonElement>();
        var firstOperationId = firstBody.GetProperty("operation").GetProperty("id").GetString();

        using var secondResponse = await client.PostAsJsonAsync(
            "/api/sales",
            new { ean13 = "7351353713578", quantity = 2 });
        Assert.Equal(HttpStatusCode.Created, secondResponse.StatusCode);

        using var archive = await client.PostAsync("/api/articles/7351353713578/archive", null);
        Assert.Equal(HttpStatusCode.OK, archive.StatusCode);

        using var firstRead = await client.GetAsync($"/api/sales/{firstOperationId}");
        Assert.Equal(HttpStatusCode.OK, firstRead.StatusCode);
        var firstReadBody = await firstRead.Content.ReadFromJsonAsync<JsonElement>();
        var firstPosition = firstReadBody.GetProperty("position");
        Assert.Equal(5, firstPosition.GetProperty("physicalQuantity").GetInt32());
        Assert.Equal(5, firstPosition.GetProperty("sellableQuantity").GetInt32());
        Assert.True(firstPosition.GetProperty("isActive").GetBoolean());
        Assert.Equal("AVAILABLE", firstPosition.GetProperty("availability").GetString());

        var secondBody = await secondResponse.Content.ReadFromJsonAsync<JsonElement>();
        var secondOperationId = secondBody.GetProperty("operation").GetProperty("id").GetString();
        using var secondRead = await client.GetAsync($"/api/sales/{secondOperationId}");
        Assert.Equal(HttpStatusCode.OK, secondRead.StatusCode);
        var secondReadBody = await secondRead.Content.ReadFromJsonAsync<JsonElement>();
        var secondPosition = secondReadBody.GetProperty("position");
        Assert.Equal(3, secondPosition.GetProperty("physicalQuantity").GetInt32());
        Assert.Equal(3, secondPosition.GetProperty("sellableQuantity").GetInt32());
        Assert.True(secondPosition.GetProperty("isActive").GetBoolean());
        Assert.Equal("AVAILABLE", secondPosition.GetProperty("availability").GetString());
    }

    [Fact]
    public async Task Rejects_a_sale_when_the_catalogue_price_version_changes_after_the_quote()
    {
        var quoteGate = new SaleQuoteGate();
        using var factory = new HostFactory(Now, quoteGate);
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync(
            "7351353713578",
            "Batterie industrielle",
            type: "nonFood",
            packaging: "new",
            physicalQuantity: 8,
            priceHtCents: 101);

        var saleTask = client.PostAsJsonAsync(
            "/api/sales",
            new { ean13 = "7351353713578", quantity = 1 });
        var quotedArticle = await quoteGate.Quoted.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(0, quotedArticle.Version);

        using var priceUpdate = await client.PatchAsJsonAsync(
            "/api/articles/7351353713578",
            new { priceHtCents = 202 });
        Assert.Equal(HttpStatusCode.OK, priceUpdate.StatusCode);
        quoteGate.Release.TrySetResult();

        using var response = await saleTask;
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("POSITION_CONFLICT", problem.GetProperty("code").GetString());

        var state = await factory.ReadFreshAsync(async context => new
        {
            Position = await context.StockPositions.SingleAsync(),
            Sales = await context.StockOperations.CountAsync(operation => operation.Type == "SALE")
        });
        Assert.Equal(8, state.Position.PhysicalQuantity);
        Assert.Equal(0, state.Sales);
    }

    [Fact]
    public async Task Maps_financial_overflow_to_invalid_input_without_writing()
    {
        using var factory = new HostFactory(Now);
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync(
            "7351353713578",
            "Batterie hors capacité",
            type: "nonFood",
            packaging: "new",
            physicalQuantity: 8,
            priceHtCents: int.MaxValue);

        using var response = await client.PostAsJsonAsync(
            "/api/sales",
            new { ean13 = "7351353713578", quantity = 1 });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("INVALID_INPUT", problem.GetProperty("code").GetString());
        Assert.Contains("quantity", problem.GetProperty("errors").EnumerateObject()
            .Select(error => error.Name));

        var state = await factory.ReadFreshAsync(async context => new
        {
            Position = await context.StockPositions.SingleAsync(
                position => position.Ean13 == "7351353713578"),
            Sales = await context.StockOperations.CountAsync(operation => operation.Type == "SALE")
        });
        Assert.Equal(8, state.Position.PhysicalQuantity);
        Assert.Equal(0, state.Sales);
    }

    [Fact]
    public async Task Maps_unexpected_sale_failures_to_sanitized_internal_errors()
    {
        using var factory = new HostFactory(Now);
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync(
            "7351353713578",
            "Batterie industrielle",
            type: "nonFood",
            packaging: "new",
            physicalQuantity: 8,
            priceHtCents: 101);
        await factory.FailSaleOperationInsertsAsync();

        using var response = await client.PostAsJsonAsync(
            "/api/sales",
            new { ean13 = "7351353713578", quantity = 1 });

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadAsStringAsync();
        using var problem = JsonDocument.Parse(body);
        Assert.Equal("INTERNAL_ERROR", problem.RootElement.GetProperty("code").GetString());
        Assert.DoesNotContain("SQLite", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("EntityFramework", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(nameof(InvalidOperationException), body);
        Assert.DoesNotContain("stack trace", body, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(
            0,
            await factory.ReadFreshAsync(context => context.StockOperations.CountAsync(operation => operation.Type == "SALE")));
        Assert.Equal(
            8,
            await factory.ReadFreshAsync(context => context.StockPositions
                .Where(position => position.Ean13 == "7351353713578")
                .Select(position => position.PhysicalQuantity)
                .SingleAsync()));
    }

    [Fact]
    public async Task Searches_articles_with_price_and_both_stock_quantities()
    {
        using var factory = new HostFactory(Now);
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync(
            "7351353713578",
            "Batterie industrielle",
            type: "nonFood",
            packaging: "new",
            physicalQuantity: 8,
            priceHtCents: 101);

        using var response = await client.GetAsync("/api/sales/articles?search=Batterie");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var articles = await response.Content.ReadFromJsonAsync<JsonElement>();
        var article = Assert.Single(articles.EnumerateArray().ToArray());
        Assert.Equal("7351353713578", article.GetProperty("ean13").GetString());
        Assert.Equal("nonFood", article.GetProperty("type").GetString());
        Assert.Equal(101, article.GetProperty("priceHtCents").GetInt32());
        Assert.Equal(8, article.GetProperty("physicalQuantity").GetInt32());
        Assert.Equal(8, article.GetProperty("sellableQuantity").GetInt32());

        using var eanResponse = await client.GetAsync("/api/sales/articles?search=7351353713578");
        Assert.Equal(HttpStatusCode.OK, eanResponse.StatusCode);
        var eanArticles = await eanResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("7351353713578", Assert.Single(eanArticles.EnumerateArray().ToArray())
            .GetProperty("ean13").GetString());
    }

    [Fact]
    public async Task Sells_a_single_mode_food_article_with_an_inferred_takeaway_context()
    {
        using var factory = new HostFactory(Now);
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync(
            "0123456789012",
            "Café à emporter",
            type: "food",
            dlc: "2030-01-15",
            physicalQuantity: 8,
            priceHtCents: 101,
            consumptionModes: "takeaway");

        using var response = await client.PostAsJsonAsync(
            "/api/sales",
            new { ean13 = "0123456789012", quantity = 2 });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("takeaway", body.GetProperty("financial").GetProperty("context").GetString());
        Assert.Equal("takeaway", body.GetProperty("financial").GetProperty("taxRate").GetProperty("code").GetString());
        Assert.Equal(202, body.GetProperty("financial").GetProperty("amountHtCents").GetInt32());
        Assert.Equal(11, body.GetProperty("financial").GetProperty("vatCents").GetInt32());
        Assert.Equal(213, body.GetProperty("financial").GetProperty("amountTtcCents").GetInt32());
    }

    [Fact]
    public async Task Requires_and_preserves_one_context_for_a_two_mode_food_article()
    {
        using var factory = new HostFactory(Now);
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync(
            "0123456789012",
            "Café sur place ou à emporter",
            type: "food",
            dlc: "2030-01-15",
            physicalQuantity: 8,
            priceHtCents: 101,
            consumptionModes: "takeaway,onsite");

        using var search = await client.GetAsync("/api/sales/articles?search=0123456789012");
        var article = Assert.Single((await search.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray());
        Assert.Equal(2, article.GetProperty("consumptionModes").GetArrayLength());
        Assert.Equal(2, article.GetProperty("priceQuotes").GetArrayLength());

        using var missing = await client.PostAsJsonAsync(
            "/api/sales",
            new { ean13 = "0123456789012", quantity = 1 });
        Assert.Equal(HttpStatusCode.Conflict, missing.StatusCode);
        var missingBody = await missing.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("CONTEXT_REQUIRED", missingBody.GetProperty("code").GetString());
        Assert.True(missingBody.GetProperty("errors").GetProperty("context").GetArrayLength() > 0);

        using var takeaway = await client.PostAsJsonAsync(
            "/api/sales",
            new { ean13 = "0123456789012", quantity = 1, context = "takeaway" });
        Assert.Equal(HttpStatusCode.Created, takeaway.StatusCode);
        var takeawayBody = await takeaway.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("takeaway", takeawayBody.GetProperty("financial").GetProperty("context").GetString());
        Assert.Equal(7, takeawayBody.GetProperty("position").GetProperty("physicalQuantity").GetInt32());

        using var onsite = await client.PostAsJsonAsync(
            "/api/sales",
            new { ean13 = "0123456789012", quantity = 1, context = "onsite" });
        Assert.Equal(HttpStatusCode.Created, onsite.StatusCode);
        var onsiteBody = await onsite.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("onsite", onsiteBody.GetProperty("financial").GetProperty("context").GetString());
        Assert.Equal("onsite", onsiteBody.GetProperty("financial").GetProperty("taxRate").GetProperty("code").GetString());
        Assert.Equal(10, onsiteBody.GetProperty("financial").GetProperty("vatCents").GetInt32());
        Assert.Equal(6, onsiteBody.GetProperty("position").GetProperty("physicalQuantity").GetInt32());
    }

    [Fact]
    public async Task Maps_context_mismatch_and_non_food_context_to_stable_problem_codes()
    {
        using var factory = new HostFactory(Now);
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync(
            "0123456789012",
            "Café à emporter",
            type: "food",
            dlc: "2030-01-15",
            physicalQuantity: 8,
            consumptionModes: "takeaway");
        await factory.SeedArticleAsync(
            "7351353713578",
            "Batterie industrielle",
            type: "nonFood",
            packaging: "new",
            physicalQuantity: 8);

        using var incompatible = await client.PostAsJsonAsync(
            "/api/sales",
            new { ean13 = "0123456789012", quantity = 1, context = "onsite" });
        Assert.Equal(HttpStatusCode.Conflict, incompatible.StatusCode);
        var incompatibleBody = await incompatible.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("CONTEXT_INCOMPATIBLE", incompatibleBody.GetProperty("code").GetString());
        Assert.True(incompatibleBody.GetProperty("errors").GetProperty("context").GetArrayLength() > 0);

        using var notAllowed = await client.PostAsJsonAsync(
            "/api/sales",
            new { ean13 = "7351353713578", quantity = 1, context = "takeaway" });
        Assert.Equal(HttpStatusCode.Conflict, notAllowed.StatusCode);
        var notAllowedBody = await notAllowed.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("CONTEXT_NOT_ALLOWED", notAllowedBody.GetProperty("code").GetString());
        Assert.True(notAllowedBody.GetProperty("errors").GetProperty("context").GetArrayLength() > 0);
        Assert.Equal(
            0,
            await factory.ReadFreshAsync(context => context.StockOperations.CountAsync(operation => operation.Type == "SALE")));
    }

    [Fact]
    public async Task Rejects_invalid_sale_input_and_context_without_writes()
    {
        using var factory = new HostFactory(Now);
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync(
            "7351353713578",
            "Batterie industrielle",
            type: "nonFood",
            packaging: "new",
            physicalQuantity: 8,
            priceHtCents: 101);

        using var invalid = await client.PostAsJsonAsync(
            "/api/sales",
            new { ean13 = "7351353713578", quantity = 0, amountHtCents = 303 });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal("application/problem+json", invalid.Content.Headers.ContentType?.MediaType);
        var invalidBody = await invalid.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("INVALID_INPUT", invalidBody.GetProperty("code").GetString());
        Assert.True(invalidBody.GetProperty("errors").GetProperty("quantity").GetArrayLength() > 0);
        Assert.True(invalidBody.GetProperty("errors").GetProperty("amountHtCents").GetArrayLength() > 0);

        using var context = await client.PostAsJsonAsync(
            "/api/sales",
            new { ean13 = "7351353713578", quantity = 1, context = "takeaway" });
        Assert.Equal(HttpStatusCode.Conflict, context.StatusCode);
        var contextBody = await context.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("CONTEXT_NOT_ALLOWED", contextBody.GetProperty("code").GetString());
        Assert.Equal(
            0,
            await factory.ReadFreshAsync(db => db.StockOperations.CountAsync(operation => operation.Type == "SALE")));
        Assert.Equal(
            8,
            await factory.ReadFreshAsync(db => db.StockPositions.Select(position => position.PhysicalQuantity).SingleAsync()));
    }

    [Fact]
    public async Task Rolls_back_prepared_stock_when_the_commit_participant_fails()
    {
        using var factory = new HostFactory(Now);
        await factory.SeedAsync();

        using var scope = factory.Services.CreateScope();
        var contract = scope.ServiceProvider.GetRequiredService<IStockSaleContract>();
        var participant = new SentinelParticipantPersistenceAdapter(
            "financial-sentinel",
            "{\"saleId\":\"sentinel-rollback\"}",
            failAfterPrepare: true);
        var result = await contract.RecordAsync(
            new StockSaleCommand
            {
                Ean13 = "0123456789012",
                Quantity = 3
            },
            participant);

        Assert.Equal(StockSaleStatus.PersistenceFailed, result.Status);
        Assert.Null(result.Receipt);
        Assert.True(participant.Staged);

        var state = await factory.ReadFreshAsync(async context => new
        {
            Operations = await context.StockOperations.CountAsync(),
            ParticipantPayload = await context.StockOperations
                .Select(operation => operation.SaleCommitDataPayload)
                .SingleOrDefaultAsync(),
            Position = await context.StockPositions.SingleAsync()
        });
        Assert.Equal(0, state.Operations);
        Assert.Null(state.ParticipantPayload);
        Assert.Equal(8, state.Position.PhysicalQuantity);
        Assert.Equal(2, state.Position.Version);
    }

    [Fact]
    public async Task Rejects_unknown_archived_expired_unsellable_and_insufficient_sales_without_writes()
    {
        using var factory = new HostFactory(Now);
        await factory.SeedAsync();
        await factory.SeedArticleAsync(
            "4006381333931",
            "archived",
            isActive: false,
            dlc: "2030-01-15",
            physicalQuantity: 4);
        await factory.SeedArticleAsync(
            "7351353713578",
            "expired",
            dlc: "2030-01-14",
            physicalQuantity: 4);
        await factory.SeedArticleAsync(
            "5901234123457",
            "unsellable",
            type: "nonFood",
            packaging: "unsellable",
            physicalQuantity: 4);
        await factory.SeedArticleAsync(
            "5012345678900",
            "insufficient",
            physicalQuantity: 2);

        using var scope = factory.Services.CreateScope();
        var contract = scope.ServiceProvider.GetRequiredService<IStockSaleContract>();
        var cases = new[]
        {
            ("4006381333931", StockSaleStatus.NotSellable),
            ("7351353713578", StockSaleStatus.NotSellable),
            ("5901234123457", StockSaleStatus.NotSellable),
            ("5012345678900", StockSaleStatus.OutOfStock),
            ("5012345678917", StockSaleStatus.ArticleNotFound)
        };

        foreach (var (ean13, expectedStatus) in cases)
        {
            var result = await contract.RecordAsync(new StockSaleCommand
            {
                Ean13 = ean13,
                Quantity = 3
            });

            Assert.Equal(expectedStatus, result.Status);
            Assert.Null(result.Receipt);
            Assert.NotEmpty(result.Errors);
            Assert.Equal(0, await factory.ReadFreshAsync(context => context.StockOperations.CountAsync()));
        }
    }

    [Fact]
    public async Task Rejects_a_sale_plan_when_the_position_changed_after_verification()
    {
        using var factory = new HostFactory(Now);
        await factory.SeedAsync();

        using var scope = factory.Services.CreateScope();
        var article = await scope.ServiceProvider
            .GetRequiredService<IArticleSellabilityReader>()
            .FindSellabilityByEanAsync(ParseEan("0123456789012"));
        var currentPosition = await scope.ServiceProvider
            .GetRequiredService<IStockPositionReader>()
            .FindByEanAsync(ParseEan("0123456789012"));
        var operation = StockOperation.CreateSale(
            "stale-sale",
            ParseEan("0123456789012"),
            new Quantity(3),
            Now);
        await factory.UpdatePositionAsync(5, 3);

        var commit = await scope.ServiceProvider
            .GetRequiredService<IStockMutationCommitter>()
            .CommitAsync(new StockSaleCommitPlan(
                article!,
                currentPosition,
                currentPosition!.ApplyEffect(-3),
                operation,
                new DateOnly(2030, 1, 15)));

        Assert.Equal(StockMutationCommitStatus.Conflict, commit.Status);
        var state = await factory.ReadFreshAsync(async context => new
        {
            Operations = await context.StockOperations.CountAsync(),
            Position = await context.StockPositions.SingleAsync()
        });
        Assert.Equal(0, state.Operations);
        Assert.Equal(5, state.Position.PhysicalQuantity);
        Assert.Equal(3, state.Position.Version);
    }

    [Fact]
    public async Task Revalidates_the_current_article_policy_before_committing()
    {
        using var factory = new HostFactory(Now);
        await factory.SeedAsync();

        using var scope = factory.Services.CreateScope();
        var article = await scope.ServiceProvider
            .GetRequiredService<IArticleSellabilityReader>()
            .FindSellabilityByEanAsync(ParseEan("0123456789012"));
        var currentPosition = await scope.ServiceProvider
            .GetRequiredService<IStockPositionReader>()
            .FindByEanAsync(ParseEan("0123456789012"));
        var operation = StockOperation.CreateSale(
            "archived-sale",
            ParseEan("0123456789012"),
            new Quantity(3),
            Now);
        await factory.ArchiveArticleAsync();

        var commit = await scope.ServiceProvider
            .GetRequiredService<IStockMutationCommitter>()
            .CommitAsync(new StockSaleCommitPlan(
                article!,
                currentPosition,
                currentPosition!.ApplyEffect(-3),
                operation,
                new DateOnly(2030, 1, 15)));

        Assert.Equal(StockMutationCommitStatus.Conflict, commit.Status);
        var state = await factory.ReadFreshAsync(async context => new
        {
            Article = await context.Articles.SingleAsync(),
            Operations = await context.StockOperations.CountAsync(),
            Position = await context.StockPositions.SingleAsync()
        });
        Assert.False(state.Article.IsActive);
        Assert.Equal(0, state.Operations);
        Assert.Equal(8, state.Position.PhysicalQuantity);
        Assert.Equal(2, state.Position.Version);
    }

    private static Ean13 ParseEan(string value)
    {
        Assert.True(Ean13.TryCreate(value, out var ean13));
        return ean13;
    }

    private sealed class SaleQuoteGate
    {
        public TaskCompletionSource<ArticleSaleSnapshot> Quoted { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public TaskCompletionSource Release { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
    }

    private sealed class BlockingArticleSaleReader(
        IArticleStore store,
        SaleQuoteGate gate) : IArticleSaleReader
    {
        public async ValueTask<ArticleSaleSnapshot?> FindByEanAsync(
            Ean13 ean13,
            CancellationToken cancellationToken = default)
        {
            var snapshot = await new ArticleSaleReader(store)
                .FindByEanAsync(ean13, cancellationToken);
            if (snapshot is null)
            {
                return null;
            }

            gate.Quoted.TrySetResult(snapshot);
            await gate.Release.Task.WaitAsync(cancellationToken);
            return snapshot;
        }

        public ValueTask<IReadOnlyList<ArticleSaleSnapshot>> SearchAsync(
            string? search,
            CancellationToken cancellationToken = default)
            => new ArticleSaleReader(store).SearchAsync(search, cancellationToken);
    }

    private sealed class HostFactory(
        DateTimeOffset now,
        SaleQuoteGate? saleQuoteGate = null) : WebApplicationFactory<Program>
    {
        private readonly string databasePath = Path.Combine(
            Path.GetTempPath(),
            $"token-warehouse-sale-{Guid.NewGuid():N}.db");

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:Warehouse", $"Data Source={databasePath}");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IClock>();
                services.AddSingleton<IClock>(new FixedClock(now));
                if (saleQuoteGate is not null)
                {
                    services.RemoveAll<IArticleSaleReader>();
                    services.AddScoped<IArticleSaleReader>(provider =>
                        new BlockingArticleSaleReader(
                            provider.GetRequiredService<IArticleStore>(),
                            saleQuoteGate));
                }
            });
        }

        public Task SeedAsync()
            => SeedArticleAsync(
                "0123456789012",
                "Article vendable",
                dlc: "2030-01-15",
                physicalQuantity: 8,
                positionVersion: 2);

        public async Task SeedArticleAsync(
            string ean13,
            string name,
            string type = "food",
            bool isActive = true,
            string? dlc = null,
            string? packaging = null,
            int physicalQuantity = 0,
            int positionVersion = 0,
            int priceHtCents = 1000,
            string? consumptionModes = null)
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            context.Articles.Add(new ArticleEntity
            {
                Ean13 = ean13,
                Type = type,
                Name = name,
                NameSearchKey = name.ToUpperInvariant(),
                PriceHtCents = priceHtCents,
                IsActive = isActive,
                Version = 0,
                Dlc = dlc,
                ConsumptionModes = type == "food" ? consumptionModes ?? "takeaway" : null,
                Packaging = packaging
            });
            context.StockPositions.Add(new StockPositionEntity
            {
                Ean13 = ean13,
                PhysicalQuantity = physicalQuantity,
                Version = positionVersion
            });
            await context.SaveChangesAsync();
        }

        public async Task UpdatePositionAsync(int physicalQuantity, int version)
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            var position = await context.StockPositions.SingleAsync();
            position.PhysicalQuantity = physicalQuantity;
            position.Version = version;
            await context.SaveChangesAsync();
        }

        public async Task FailSaleOperationInsertsAsync()
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            await context.Database.ExecuteSqlRawAsync(
                """
                CREATE TRIGGER FailSaleOperationInsert
                BEFORE INSERT ON StockOperations
                WHEN NEW.Type = 'SALE'
                BEGIN
                    SELECT RAISE(ABORT, 'controlled sale failure');
                END;
                """);
        }

        public async Task ArchiveArticleAsync()
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            var article = await context.Articles.SingleAsync();
            article.IsActive = false;
            article.Version++;
            await context.SaveChangesAsync();
        }

        public async Task<T> ReadFreshAsync<T>(Func<WarehouseDbContext, Task<T>> read)
        {
            await using var connection = new SqliteConnection($"Data Source={databasePath}");
            await connection.OpenAsync();
            var options = new DbContextOptionsBuilder<WarehouseDbContext>()
                .UseSqlite(connection)
                .Options;
            await using var context = new WarehouseDbContext(options);
            return await read(context);
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

    private sealed class FixedClock(DateTimeOffset now) : IClock
    {
        public DateTimeOffset UtcNow => now;
    }

    private sealed class SentinelParticipantPersistenceAdapter(
        string dataType,
        string payload,
        bool failAfterPrepare = false) : IStockSaleCommitParticipant
    {
        public bool Staged { get; private set; }

        public string? OperationId { get; private set; }

        public async ValueTask PrepareAsync(
            IStockSaleTransaction transaction,
            StockOperation operation,
            StockPositionView resultingPosition,
            CancellationToken cancellationToken = default)
        {
            OperationId = operation.Id;
            await transaction.StageAsync(
                new StockSaleCommitData(dataType, payload),
                cancellationToken);
            Staged = true;
            if (failAfterPrepare)
            {
                throw new InvalidOperationException("financial write failed after staging");
            }
        }
    }

}
