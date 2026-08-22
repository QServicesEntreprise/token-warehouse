using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Data.Common;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;
using TokenWarehouse.Infrastructure.Persistence;
using Xunit;

namespace TokenWarehouse.Api.Tests;

public sealed class HistoryApiTests
{
    [Fact]
    public async Task Merges_stock_and_catalogue_facts_in_deterministic_order_and_filters_bulk_lines()
    {
        using var factory = new HistoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedAsync();
        var before = await factory.SnapshotAsync();

        using var response = await client.GetAsync("/api/history");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(4, body.RootElement.GetArrayLength());
        Assert.Equal("COUNTER_MOVEMENT", body.RootElement[0].GetProperty("type").GetString());
        Assert.Equal("counter-0004", body.RootElement[0].GetProperty("id").GetString());
        Assert.Equal("bulk-0002", body.RootElement[0].GetProperty("sourceOperationId").GetString());
        Assert.Equal("Correction de contrôle", body.RootElement[0].GetProperty("justification").GetString());
        Assert.False(body.RootElement[0].TryGetProperty("previousPhysicalStock", out _));
        Assert.False(body.RootElement[0].GetProperty("lines")[0].TryGetProperty("previousPhysicalStock", out _));
        Assert.Equal("CATALOG_ARCHIVE", body.RootElement[1].GetProperty("type").GetString());
        Assert.Equal("fact_catalog_archive_01J00000000000000000000000", body.RootElement[1].GetProperty("id").GetString());
        Assert.Equal("INVENTORY", body.RootElement[2].GetProperty("type").GetString());
        Assert.Equal(5, body.RootElement[2].GetProperty("countedQuantity").GetInt32());
        Assert.Equal(0, body.RootElement[2].GetProperty("difference").GetInt32());
        var bulkRoot = body.RootElement[3];
        Assert.Equal("bulk-0002", bulkRoot.GetProperty("id").GetString());
        Assert.Equal(2, bulkRoot.GetProperty("lines").GetArrayLength());
        Assert.False(bulkRoot.TryGetProperty("quantity", out _));
        Assert.False(bulkRoot.TryGetProperty("previousPhysicalStock", out _));
        Assert.False(bulkRoot.TryGetProperty("resultingPhysicalStock", out _));
        Assert.Equal(2, bulkRoot.GetProperty("lines")[0].GetProperty("quantity").GetInt32());
        Assert.Equal(2, bulkRoot.GetProperty("lines")[0].GetProperty("stockEffect").GetInt32());
        Assert.Equal(3, bulkRoot.GetProperty("lines")[1].GetProperty("quantity").GetInt32());
        Assert.Equal(3, bulkRoot.GetProperty("lines")[1].GetProperty("stockEffect").GetInt32());

        using var filtered = await client.GetAsync("/api/history?ean13=0123456789012");
        using var filteredBody = JsonDocument.Parse(await filtered.Content.ReadAsStringAsync());
        var bulk = filteredBody.RootElement.EnumerateArray()
            .Single(entry => entry.GetProperty("id").GetString() == "bulk-0002");
        Assert.Equal(1, bulk.GetProperty("lines").GetArrayLength());
        Assert.Equal("0123456789012", bulk.GetProperty("lines")[0].GetProperty("ean13").GetString());
        Assert.False(bulk.TryGetProperty("quantity", out _));
        Assert.False(bulk.TryGetProperty("previousPhysicalStock", out _));
        Assert.False(bulk.TryGetProperty("resultingPhysicalStock", out _));
        Assert.DoesNotContain(
            filteredBody.RootElement.EnumerateArray(),
            entry => entry.GetProperty("articles").EnumerateArray().Any(article => article.GetProperty("ean13").GetString() == "7351353713578"));

        using var archived = await client.GetAsync("/api/history?ean13=5901234123457");
        using var archivedBody = JsonDocument.Parse(await archived.Content.ReadAsStringAsync());
        var archivedEntry = Assert.Single(archivedBody.RootElement.EnumerateArray());
        Assert.Equal("CATALOG_ARCHIVE", archivedEntry.GetProperty("type").GetString());
        Assert.Equal("fact_catalog_archive_01J00000000000000000000000", archivedEntry.GetProperty("id").GetString());

        using var unknown = await client.GetAsync("/api/history?ean13=4006381333931");
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        using var unknownBody = JsonDocument.Parse(await unknown.Content.ReadAsStringAsync());
        Assert.Equal("ARTICLE_NOT_FOUND", unknownBody.RootElement.GetProperty("code").GetString());

        using var invalid = await client.GetAsync("/api/history?ean13=not-an-ean");
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        using var invalidBody = JsonDocument.Parse(await invalid.Content.ReadAsStringAsync());
        Assert.Equal("INVALID_EAN13", invalidBody.RootElement.GetProperty("code").GetString());

        using var repeatedGlobal = await client.GetAsync("/api/history");
        using var repeatedFiltered = await client.GetAsync("/api/history?ean13=0123456789012");
        Assert.Equal(HttpStatusCode.OK, repeatedGlobal.StatusCode);
        Assert.Equal(HttpStatusCode.OK, repeatedFiltered.StatusCode);
        Assert.Equal(before, await factory.ReadFreshSnapshotAsync());
    }

    [Fact]
    public async Task Returns_an_empty_collection_for_a_known_article_without_history()
    {
        using var factory = new HistoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync("0123456789012");

        using var response = await client.GetAsync("/api/history?ean13=0123456789012");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Empty(body.RootElement.EnumerateArray());
    }

    [Fact]
    public async Task Omits_previous_stock_for_a_synthetic_counter_movement_line()
    {
        using var factory = new HistoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedSyntheticCounterMovementAsync();

        using var response = await client.GetAsync("/api/history?ean13=0123456789012");
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var entry = Assert.Single(
            body.RootElement.EnumerateArray(),
            item => item.GetProperty("type").GetString() == "COUNTER_MOVEMENT");

        Assert.Equal("COUNTER_MOVEMENT", entry.GetProperty("type").GetString());
        Assert.False(entry.TryGetProperty("previousPhysicalStock", out _));
        Assert.False(entry.GetProperty("lines")[0].TryGetProperty("previousPhysicalStock", out _));
    }

    [Fact]
    public async Task Reads_the_committed_resulting_stock_of_a_supply()
    {
        using var factory = new HistoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync("0123456789012");

        using var supply = await client.PostAsJsonAsync(
            "/api/supplies",
            new { ean13 = "0123456789012", quantity = 3 });
        Assert.Equal(HttpStatusCode.Created, supply.StatusCode);

        using var response = await client.GetAsync("/api/history?ean13=0123456789012");
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var entry = Assert.Single(body.RootElement.EnumerateArray());
        Assert.Equal("SUPPLY", entry.GetProperty("type").GetString());
        Assert.Equal(3, entry.GetProperty("quantity").GetInt32());
        Assert.Equal(3, entry.GetProperty("stockEffect").GetInt32());
        Assert.Equal(3, entry.GetProperty("resultingPhysicalStock").GetInt32());
        Assert.Equal(3, entry.GetProperty("lines")[0].GetProperty("resultingPhysicalStock").GetInt32());
    }

    [Fact]
    public async Task Reads_the_sale_snapshot_and_its_signed_counter_movement_in_history()
    {
        using var factory = new HistoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync("0123456789012");

        using var supply = await client.PostAsJsonAsync(
            "/api/supplies",
            new { ean13 = "0123456789012", quantity = 3 });
        Assert.Equal(HttpStatusCode.Created, supply.StatusCode);

        using var sale = await client.PostAsJsonAsync(
            "/api/sales",
            new { ean13 = "0123456789012", quantity = 2 });
        Assert.Equal(HttpStatusCode.Created, sale.StatusCode);
        using var saleBody = JsonDocument.Parse(await sale.Content.ReadAsStringAsync());
        var saleId = saleBody.RootElement.GetProperty("operation").GetProperty("id").GetString();

        using var history = await client.GetAsync("/api/history?ean13=0123456789012");
        using var historyBody = JsonDocument.Parse(await history.Content.ReadAsStringAsync());
        var saleEntry = Assert.Single(
            historyBody.RootElement.EnumerateArray(),
            entry => entry.GetProperty("type").GetString() == "SALE_STOCK");
        var financial = saleEntry.GetProperty("financial");
        Assert.Equal(100, financial.GetProperty("unitPriceHtCents").GetInt32());
        Assert.Equal("takeaway", financial.GetProperty("context").GetString());
        Assert.Equal("takeaway", financial.GetProperty("taxRate").GetProperty("code").GetString());
        Assert.Equal(200, financial.GetProperty("amountHtCents").GetInt32());
        Assert.Equal(11, financial.GetProperty("vatCents").GetInt32());
        Assert.Equal(211, financial.GetProperty("amountTtcCents").GetInt32());

        using var counter = await client.PostAsJsonAsync(
            "/api/stock/counter-movements",
            new { sourceOperationId = saleId, justification = "Correction financière" });
        Assert.Equal(HttpStatusCode.Created, counter.StatusCode);

        using var correctedHistory = await client.GetAsync("/api/history?ean13=0123456789012");
        using var correctedBody = JsonDocument.Parse(await correctedHistory.Content.ReadAsStringAsync());
        var correction = Assert.Single(
            correctedBody.RootElement.EnumerateArray(),
            entry => entry.GetProperty("type").GetString() == "COUNTER_MOVEMENT");
        var reversal = correction.GetProperty("financialReversal");
        Assert.Equal(saleId, reversal.GetProperty("sourceOperationId").GetString());
        Assert.Equal(-200, reversal.GetProperty("amountHtCents").GetInt32());
        Assert.Equal(-11, reversal.GetProperty("vatCents").GetInt32());
        Assert.Equal(-211, reversal.GetProperty("amountTtcCents").GetInt32());
        Assert.Contains(
            correctedBody.RootElement.EnumerateArray(),
            entry => entry.GetProperty("id").GetString() == saleId
                && entry.GetProperty("financial").GetProperty("amountTtcCents").GetInt32() == 211);
    }

    [Fact]
    public async Task Reads_a_financial_summary_from_the_same_immutable_sale_facts()
    {
        using var factory = new HistoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedArticleAsync("0123456789012");
        await client.PostAsJsonAsync(
            "/api/supplies",
            new { ean13 = "0123456789012", quantity = 3 });
        using var sale = await client.PostAsJsonAsync(
            "/api/sales",
            new { ean13 = "0123456789012", quantity = 2 });
        using var saleBody = JsonDocument.Parse(await sale.Content.ReadAsStringAsync());
        var saleId = saleBody.RootElement.GetProperty("operation").GetProperty("id").GetString();
        using var counter = await client.PostAsJsonAsync(
            "/api/stock/counter-movements",
            new { sourceOperationId = saleId, justification = "Résumé financier" });
        Assert.Equal(HttpStatusCode.Created, counter.StatusCode);

        using var scope = factory.Services.CreateScope();
        var useCase = scope.ServiceProvider.GetRequiredService<IReadFinancialSummaryUseCase>();
        var result = await useCase.ReadAsync(new FinancialPeriod(
            DateTimeOffset.MinValue,
            DateTimeOffset.MaxValue));

        Assert.Equal(FinancialSummaryReadStatus.Success, result.Status);
        Assert.Equal(0, result.Summary!.RevenueHt.Cents);
        Assert.Equal(0, result.Summary.RevenueTtc.Cents);
        Assert.Equal(0, result.Summary.VatCollected.Cents);
        Assert.Equal(
            [TaxRate.Takeaway, TaxRate.OnSite, TaxRate.NonFood],
            result.Summary.ByTaxRate.Select(line => line.TaxRate));
        Assert.Equal(0, result.Summary.ByTaxRate[0].AmountTtc.Cents);
    }

    [Fact]
    public async Task Reads_financial_period_boundaries_and_signed_corrections_from_sqlite()
    {
        using var factory = new HistoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedFinancialPeriodFactsAsync();

        using var scope = factory.Services.CreateScope();
        var useCase = scope.ServiceProvider.GetRequiredService<IReadFinancialSummaryUseCase>();
        var period = new FinancialPeriod(
            new DateTimeOffset(2030, 1, 1, 0, 0, 0, TimeSpan.Zero),
            new DateTimeOffset(2030, 2, 1, 0, 0, 0, TimeSpan.Zero));

        var result = await useCase.ReadAsync(period);

        Assert.Equal(FinancialSummaryReadStatus.Success, result.Status);
        Assert.Equal(0, result.Summary!.RevenueHt.Cents);
        Assert.Equal(-14, result.Summary.VatCollected.Cents);
        Assert.Equal(-14, result.Summary.RevenueTtc.Cents);
        Assert.Equal(
            [(100, 6, 106), (0, 0, 0), (-100, -20, -120)],
            result.Summary.ByTaxRate.Select(line => (
                line.AmountHt.Cents,
                line.Vat.Cents,
                line.AmountTtc.Cents)));

        var reader = scope.ServiceProvider.GetRequiredService<IFinancialFactReader>();
        var facts = await reader.ReadAsync(period);
        Assert.Equal(FinancialFactReadStatus.Success, facts.Status);
        Assert.Equal(
            ["sale-at-from", "counter-in-period"],
            facts.Facts.Select(fact => fact.OperationId));
    }

    [Fact]
    public async Task Reads_the_three_tax_rates_from_persisted_sale_snapshots()
    {
        using var factory = new HistoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedFinancialArticlesAsync();

        foreach (var ean13 in new[] { "0123456789012", "1234567890128", "2345678901234" })
        {
            using var sale = await client.PostAsJsonAsync(
                "/api/sales",
                new { ean13, quantity = 1 });
            Assert.Equal(HttpStatusCode.Created, sale.StatusCode);
        }

        using var scope = factory.Services.CreateScope();
        var useCase = scope.ServiceProvider.GetRequiredService<IReadFinancialSummaryUseCase>();
        var result = await useCase.ReadAsync(new FinancialPeriod(
            DateTimeOffset.MinValue,
            DateTimeOffset.MaxValue));

        Assert.Equal(FinancialSummaryReadStatus.Success, result.Status);
        Assert.Equal(300, result.Summary!.RevenueHt.Cents);
        Assert.Equal(36, result.Summary.VatCollected.Cents);
        Assert.Equal(336, result.Summary.RevenueTtc.Cents);
        Assert.Equal(
            [(100, 6, 106), (100, 10, 110), (100, 20, 120)],
            result.Summary.ByTaxRate.Select(line => (
                line.AmountHt.Cents,
                line.Vat.Cents,
                line.AmountTtc.Cents)));
    }

    [Fact]
    public async Task Orders_equal_timestamps_by_operation_id()
    {
        using var factory = new HistoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedEqualTimestampOperationsAsync();

        using var response = await client.GetAsync("/api/history");
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

        Assert.Equal(
            new[] { "operation-0002", "operation-0001" },
            body.RootElement.EnumerateArray().Select(entry => entry.GetProperty("id").GetString()).ToArray());
    }

    [Fact]
    public async Task Reads_sale_inventory_and_catalogue_facts_for_active_and_archived_articles()
    {
        using var factory = new HistoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedCoverageAsync();

        using var response = await client.GetAsync("/api/history");
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var entries = body.RootElement.EnumerateArray().ToArray();

        var sale = Assert.Single(entries, entry => entry.GetProperty("type").GetString() == "SALE_STOCK");
        Assert.Equal(3, sale.GetProperty("quantity").GetInt32());
        Assert.Equal(-3, sale.GetProperty("stockEffect").GetInt32());
        Assert.Equal(7, sale.GetProperty("resultingPhysicalStock").GetInt32());

        var positiveInventory = Assert.Single(entries, entry => entry.GetProperty("id").GetString() == "inventory-positive-0006");
        Assert.Equal("INVENTORY", positiveInventory.GetProperty("type").GetString());
        Assert.Equal(11, positiveInventory.GetProperty("countedQuantity").GetInt32());
        Assert.Equal(3, positiveInventory.GetProperty("difference").GetInt32());
        Assert.Equal(11, positiveInventory.GetProperty("resultingPhysicalStock").GetInt32());
        var positiveInventoryLine = Assert.Single(positiveInventory.GetProperty("lines").EnumerateArray());
        Assert.Equal(11, positiveInventoryLine.GetProperty("countedQuantity").GetInt32());
        Assert.Equal(3, positiveInventoryLine.GetProperty("difference").GetInt32());
        Assert.Equal(11, positiveInventoryLine.GetProperty("resultingPhysicalStock").GetInt32());

        var negativeInventory = Assert.Single(entries, entry => entry.GetProperty("id").GetString() == "inventory-negative-0007");
        Assert.Equal("INVENTORY", negativeInventory.GetProperty("type").GetString());
        Assert.Equal(7, negativeInventory.GetProperty("countedQuantity").GetInt32());
        Assert.Equal(-3, negativeInventory.GetProperty("difference").GetInt32());
        Assert.Equal(7, negativeInventory.GetProperty("resultingPhysicalStock").GetInt32());
        var negativeInventoryLine = Assert.Single(negativeInventory.GetProperty("lines").EnumerateArray());
        Assert.Equal(7, negativeInventoryLine.GetProperty("countedQuantity").GetInt32());
        Assert.Equal(-3, negativeInventoryLine.GetProperty("difference").GetInt32());
        Assert.Equal(7, negativeInventoryLine.GetProperty("resultingPhysicalStock").GetInt32());

        var zeroInventory = Assert.Single(entries, entry => entry.GetProperty("id").GetString() == "inventory-zero-0008");
        Assert.Equal("INVENTORY", zeroInventory.GetProperty("type").GetString());
        Assert.Equal(4, zeroInventory.GetProperty("countedQuantity").GetInt32());
        Assert.Equal(0, zeroInventory.GetProperty("difference").GetInt32());
        Assert.Equal(4, zeroInventory.GetProperty("resultingPhysicalStock").GetInt32());
        var zeroInventoryLine = Assert.Single(zeroInventory.GetProperty("lines").EnumerateArray());
        Assert.Equal(4, zeroInventoryLine.GetProperty("countedQuantity").GetInt32());
        Assert.Equal(0, zeroInventoryLine.GetProperty("difference").GetInt32());
        Assert.Equal(4, zeroInventoryLine.GetProperty("resultingPhysicalStock").GetInt32());

        var dlcChange = Assert.Single(entries, entry => entry.GetProperty("type").GetString() == "CATALOG_DLC_CHANGE");
        var dlcChangeValues = Assert.Single(dlcChange.GetProperty("changes").EnumerateArray());
        Assert.Equal("dlc", dlcChangeValues.GetProperty("field").GetString());
        Assert.Equal("2030-01-15", dlcChangeValues.GetProperty("before").GetString());
        Assert.Equal("2030-01-20", dlcChangeValues.GetProperty("after").GetString());

        var packagingChange = Assert.Single(entries, entry => entry.GetProperty("type").GetString() == "CATALOG_PACKAGING_CHANGE");
        var packagingChangeValues = Assert.Single(packagingChange.GetProperty("changes").EnumerateArray());
        Assert.Equal("packaging", packagingChangeValues.GetProperty("field").GetString());
        Assert.Equal("new", packagingChangeValues.GetProperty("before").GetString());
        Assert.Equal("unsellable", packagingChangeValues.GetProperty("after").GetString());

        var archivedLifecycle = Assert.Single(entries, entry => entry.GetProperty("type").GetString() == "CATALOG_ARCHIVE");
        Assert.Equal("active", archivedLifecycle.GetProperty("previousStatus").GetString());
        Assert.Equal("archived", archivedLifecycle.GetProperty("nextStatus").GetString());

        using var archived = await client.GetAsync("/api/history?ean13=5901234123457");
        using var archivedBody = JsonDocument.Parse(await archived.Content.ReadAsStringAsync());
        Assert.Contains(
            archivedBody.RootElement.EnumerateArray(),
            entry => entry.GetProperty("type").GetString() == "CATALOG_ARCHIVE");
        Assert.All(
            archivedBody.RootElement.EnumerateArray(),
            entry => Assert.All(
                entry.GetProperty("articles").EnumerateArray(),
                article => Assert.Equal("5901234123457", article.GetProperty("ean13").GetString())));
    }

    [Fact]
    public async Task Maps_history_reader_failures_to_problem_details()
    {
        using var factory = new HistoryHostFactory(failHistory: true);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/api/history");

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("HISTORY_READ_FAILURE", body.RootElement.GetProperty("code").GetString());
        Assert.DoesNotContain("SQL", body.RootElement.GetRawText(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Returns_history_read_failure_for_a_sale_without_financial_snapshot()
    {
        using var factory = new HistoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedSaleWithoutFinancialSnapshotAsync();

        using var response = await client.GetAsync("/api/history");

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("HISTORY_READ_FAILURE", body.RootElement.GetProperty("code").GetString());
        Assert.DoesNotContain("Sale financial", body.RootElement.GetRawText(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Returns_read_failures_for_a_sale_with_mismatched_persisted_financial_representations()
    {
        using var factory = new HistoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedSaleWithFinancialSnapshotsAsync(
            new SaleFinancialSnapshot(
                SaleContext.Takeaway,
                Money.FromCents(100),
                TaxRate.Takeaway,
                Money.FromCents(200),
                Money.FromCents(11),
                Money.FromCents(211)),
            new SaleFinancialSnapshot(
                SaleContext.Takeaway,
                Money.FromCents(101),
                TaxRate.Takeaway,
                Money.FromCents(202),
                Money.FromCents(11),
                Money.FromCents(213)));

        using var history = await client.GetAsync("/api/history");

        Assert.Equal(HttpStatusCode.InternalServerError, history.StatusCode);
        using var historyBody = JsonDocument.Parse(await history.Content.ReadAsStringAsync());
        Assert.Equal("HISTORY_READ_FAILURE", historyBody.RootElement.GetProperty("code").GetString());

        using var scope = factory.Services.CreateScope();
        var summary = await scope.ServiceProvider
            .GetRequiredService<IReadFinancialSummaryUseCase>()
            .ReadAsync(new FinancialPeriod(DateTimeOffset.MinValue, DateTimeOffset.MaxValue));
        var operationReader = scope.ServiceProvider.GetRequiredService<IStockOperationReader>();

        Assert.Equal(FinancialSummaryReadStatus.PersistenceFailed, summary.Status);
        Assert.Equal("FINANCIAL_READ_FAILURE", Assert.Single(summary.Errors).Code);
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => operationReader.FindByIdAsync("sale-incoherent-financial-0001").AsTask());
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => operationReader.ListAsync().AsTask());
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => operationReader.ListCorrectableAsync().AsTask());
    }

    [Fact]
    public async Task Returns_read_failures_for_a_sale_with_incoherent_financial_payload()
    {
        using var factory = new HistoryHostFactory();
        using var client = factory.CreateClient();
        await factory.SeedSaleWithFinancialSnapshotsAsync(
            new SaleFinancialSnapshot(
                SaleContext.Takeaway,
                Money.FromCents(100),
                TaxRate.Takeaway,
                Money.FromCents(200),
                Money.FromCents(11),
                Money.FromCents(211)),
            new SaleFinancialSnapshot(
                SaleContext.Takeaway,
                Money.FromCents(100),
                TaxRate.Takeaway,
                Money.FromCents(199),
                Money.FromCents(11),
                Money.FromCents(210)));

        using var response = await client.GetAsync("/api/history");

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("HISTORY_READ_FAILURE", body.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Reads_history_from_one_sqlite_snapshot_when_catalogue_changes_between_queries()
    {
        var databasePath = Path.Combine(Path.GetTempPath(), $"token-warehouse-history-snapshot-{Guid.NewGuid():N}.db");
        try
        {
            await using var setupConnection = new SqliteConnection($"Data Source={databasePath}");
            await setupConnection.OpenAsync();
            var setupOptions = new DbContextOptionsBuilder<WarehouseDbContext>()
                .UseSqlite(setupConnection)
                .Options;
            await using (var setupContext = new WarehouseDbContext(setupOptions))
            {
                await setupContext.Database.MigrateAsync();
                setupContext.Articles.Add(new ArticleEntity
                {
                    Ean13 = "0123456789012",
                    Type = "food",
                    Name = "0123456789012",
                    NameSearchKey = "0123456789012",
                    PriceHtCents = 100,
                    IsActive = true,
                    Dlc = "2099-01-15",
                    ConsumptionModes = "takeaway"
                });
                await setupContext.SaveChangesAsync();
            }
            await using (var journalModeCommand = setupConnection.CreateCommand())
            {
                journalModeCommand.CommandText = "PRAGMA journal_mode=WAL";
                await journalModeCommand.ExecuteScalarAsync();
            }
            await setupConnection.CloseAsync();

            var interceptor = new InjectLifecycleFactBeforeOperationsQuery(databasePath);
            var reader = new SqliteHistoryReader(new HistoryDbContextFactory(
                $"Data Source={databasePath}",
                interceptor));

            Ean13.TryCreate("0123456789012", out var ean13);
            var result = await reader.ReadAsync(new HistoryQuery(ean13));

            Assert.True(interceptor.WriterCommitted || interceptor.WriterBlocked);
            Assert.DoesNotContain(result.Entries, entry => entry.Id == "fact_concurrent_catalogue_01J00000000000000000000000");
            if (interceptor.WriterBlocked)
            {
                interceptor.CommitPendingFact();
            }
            var freshResult = await new SqliteHistoryReader(new HistoryDbContextFactory($"Data Source={databasePath}"))
                .ReadAsync(new HistoryQuery(ean13));
            Assert.Contains(freshResult.Entries, entry => entry.Id == "fact_concurrent_catalogue_01J00000000000000000000000");
        }
        finally
        {
            File.Delete(databasePath);
            File.Delete($"{databasePath}-wal");
            File.Delete($"{databasePath}-shm");
        }
    }

    private sealed class HistoryHostFactory(bool failHistory = false) : WebApplicationFactory<Program>
    {
        private readonly string databasePath = Path.Combine(Path.GetTempPath(), $"token-warehouse-history-{Guid.NewGuid():N}.db");

        public async Task SeedAsync()
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            context.Articles.AddRange(
                Article("0123456789012", true),
                Article("7351353713578", true),
                Article("5901234123457", false));
            context.StockOperations.AddRange(
                Operation("bulk-0002", "supply", "0123456789012", "2030-01-15T09:00:00Z"),
                Operation("inventory-0003", "INVENTORY", "0123456789012", "2030-01-15T10:00:00Z", 5, 5, 0, 5),
                Operation("counter-0004", "COUNTER_MOVEMENT", "0123456789012", "2030-01-15T11:00:00Z", sourceOperationId: "bulk-0002", sourceOperationType: "SUPPLY", justification: "Correction de contrôle"));
            context.StockOperationLines.AddRange(
                Line("bulk-0002", 1, "0123456789012", "supply", 2, sourceEffect: 2),
                Line("bulk-0002", 2, "7351353713578", "supply", 3, sourceEffect: 3),
                Line("inventory-0003", 1, "0123456789012", "INVENTORY", 0, previousPhysicalStock: 5, countedQuantity: 5, resultingPhysicalStock: 5),
                Line("counter-0004", 1, "0123456789012", "COUNTER_MOVEMENT", 0, sourceEffect: 2, inverseEffect: -2));
            context.StockPositions.AddRange(
                Position("0123456789012", 5),
                Position("7351353713578", 3),
                Position("5901234123457", 4));
            context.ArticleLifecycleHistory.Add(new ArticleLifecycleHistoryEntity
            {
                FactId = "fact_catalog_archive_01J00000000000000000000000",
                Ean13 = "5901234123457",
                PreviousStatus = "active",
                NextStatus = "archived",
                OccurredAt = "2030-01-15T10:30:00Z",
                Kind = "lifecycle"
            });
            await context.SaveChangesAsync();
        }

        public async Task SeedEqualTimestampOperationsAsync()
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            context.Articles.Add(Article("0123456789012", true));
            context.StockOperations.AddRange(
                Operation("operation-0001", "supply", "0123456789012", "2030-01-15T10:00:00Z"),
                Operation("operation-0002", "supply", "0123456789012", "2030-01-15T10:00:00Z"));
            await context.SaveChangesAsync();
        }

        public async Task SeedSyntheticCounterMovementAsync()
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            context.Articles.Add(Article("0123456789012", true));
            context.StockOperations.AddRange(
                Operation("source-synthetic-0001", "supply", "0123456789012", "2030-01-15T09:00:00Z", quantity: 2),
                Operation(
                    "counter-synthetic-0002",
                    "COUNTER_MOVEMENT",
                    "0123456789012",
                    "2030-01-15T10:00:00Z",
                    sourceOperationId: "source-synthetic-0001",
                    sourceOperationType: "SUPPLY",
                    justification: "Correction synthétique"));
            await context.SaveChangesAsync();
        }

        public async Task SeedCoverageAsync()
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            context.Articles.AddRange(
                Article("0123456789012", true),
                new ArticleEntity
                {
                    Ean13 = "7351353713578",
                    Type = "nonFood",
                    Name = "Packaging",
                    NameSearchKey = "PACKAGING",
                    PriceHtCents = 100,
                    IsActive = true,
                    Packaging = "new"
                },
                Article("5901234123457", false));
            context.StockPositions.AddRange(
                Position("0123456789012", 7),
                Position("7351353713578", 4),
                Position("5901234123457", 4));
            context.StockOperations.AddRange(
                Operation(
                    "inventory-positive-0006",
                    "INVENTORY",
                    "0123456789012",
                    "2030-01-15T08:00:00Z",
                    previousPhysicalStock: 8,
                    countedQuantity: 11,
                    inventoryDifference: 3,
                    resultingPhysicalStock: 11),
                Operation(
                    "inventory-negative-0007",
                    "INVENTORY",
                    "7351353713578",
                    "2030-01-15T08:01:00Z",
                    previousPhysicalStock: 10,
                    countedQuantity: 7,
                    inventoryDifference: -3,
                    resultingPhysicalStock: 7),
                Operation(
                    "inventory-zero-0008",
                    "INVENTORY",
                    "5901234123457",
                    "2030-01-15T08:02:00Z",
                    previousPhysicalStock: 4,
                    countedQuantity: 4,
                    inventoryDifference: 0,
                    resultingPhysicalStock: 4),
                FinancialSale(
                    "sale-0005",
                    "0123456789012",
                    "2030-01-15T10:00:00Z",
                    new SaleFinancialSnapshot(
                        SaleContext.Takeaway,
                        Money.FromCents(100),
                        TaxRate.Takeaway,
                        Money.FromCents(300),
                        Money.FromCents(17),
                        Money.FromCents(317)),
                    previousPhysicalStock: 10,
                    resultingPhysicalStock: 7,
                    quantity: 3));
            context.StockOperationLines.Add(Line(
                "inventory-positive-0006",
                1,
                "0123456789012",
                "INVENTORY",
                0,
                previousPhysicalStock: 8,
                countedQuantity: 11,
                resultingPhysicalStock: 11,
                sourceEffect: 3));
            context.StockOperationLines.Add(Line(
                "inventory-negative-0007",
                1,
                "7351353713578",
                "INVENTORY",
                0,
                previousPhysicalStock: 10,
                countedQuantity: 7,
                resultingPhysicalStock: 7,
                sourceEffect: -3));
            context.StockOperationLines.Add(Line(
                "inventory-zero-0008",
                1,
                "5901234123457",
                "INVENTORY",
                0,
                previousPhysicalStock: 4,
                countedQuantity: 4,
                resultingPhysicalStock: 4,
                sourceEffect: 0));
            context.StockOperationLines.Add(FinancialSaleLine(
                "sale-0005",
                "0123456789012",
                previousPhysicalStock: 10,
                resultingPhysicalStock: 7,
                quantity: 3));
            context.ArticleLifecycleHistory.AddRange(
                new ArticleLifecycleHistoryEntity
                {
                    FactId = "fact_catalog_dlc_01J00000000000000000000000",
                    Ean13 = "0123456789012",
                    OccurredAt = "2030-01-15T11:00:00Z",
                    Kind = "attributes",
                    ChangesJson = JsonSerializer.Serialize(new[]
                    {
                        new { Field = "dlc", PreviousValue = "2030-01-15", NextValue = "2030-01-20" }
                    })
                },
                new ArticleLifecycleHistoryEntity
                {
                    FactId = "fact_catalog_packaging_01J00000000000000000000000",
                    Ean13 = "7351353713578",
                    OccurredAt = "2030-01-15T11:01:00Z",
                    Kind = "attributes",
                    ChangesJson = JsonSerializer.Serialize(new[]
                    {
                        new { Field = "packaging", PreviousValue = "new", NextValue = "unsellable" }
                    })
                },
                new ArticleLifecycleHistoryEntity
                {
                    FactId = "fact_catalog_archive_01J00000000000000000000000",
                    Ean13 = "5901234123457",
                    PreviousStatus = "active",
                    NextStatus = "archived",
                    OccurredAt = "2030-01-15T11:02:00Z",
                    Kind = "lifecycle"
                });
            await context.SaveChangesAsync();
        }

        public async Task SeedArticleAsync(string ean13)
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            context.Articles.Add(Article(ean13, true));
            await context.SaveChangesAsync();
        }

        public async Task SeedSaleWithoutFinancialSnapshotAsync()
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            context.Articles.Add(Article("0123456789012", true));
            context.StockOperations.Add(Operation(
                "sale-missing-financial-0001",
                "SALE",
                "0123456789012",
                "2030-01-15T10:00:00Z",
                quantity: 1));
            context.StockOperationLines.Add(Line(
                "sale-missing-financial-0001",
                1,
                "0123456789012",
                "SALE",
                1,
                sourceEffect: -1));
            await context.SaveChangesAsync();
        }

        public async Task SeedSaleWithFinancialSnapshotsAsync(
            SaleFinancialSnapshot persistedSnapshot,
            SaleFinancialSnapshot payloadSnapshot)
        {
            await SeedFinancialArticlesAsync();

            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            context.StockOperations.Add(FinancialSale(
                "sale-incoherent-financial-0001",
                "0123456789012",
                "2030-01-15T10:00:00Z",
                persistedSnapshot,
                quantity: 2,
                payloadSnapshot: payloadSnapshot));
            context.StockOperationLines.Add(FinancialSaleLine(
                "sale-incoherent-financial-0001",
                "0123456789012",
                quantity: 2));
            await context.SaveChangesAsync();
        }

        public async Task SeedFinancialPeriodFactsAsync()
        {
            await SeedFinancialArticlesAsync();

            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            var takeaway = Snapshot(SaleContext.Takeaway, TaxRate.Takeaway, 6);
            var onsite = Snapshot(SaleContext.OnSite, TaxRate.OnSite, 10);
            var nonFood = Snapshot(null, TaxRate.NonFood, 20);

            context.StockOperations.AddRange(
                FinancialSale(
                    "sale-at-from",
                    "0123456789012",
                    "2030-01-01T00:00:00Z",
                    takeaway),
                FinancialSale(
                    "sale-at-to",
                    "1234567890128",
                    "2030-02-01T00:00:00Z",
                    onsite),
                FinancialSale(
                    "sale-outside",
                    "2345678901234",
                    "2029-12-31T23:59:59Z",
                    nonFood));
            context.StockOperationLines.AddRange(
                FinancialSaleLine("sale-at-from", "0123456789012"),
                FinancialSaleLine("sale-at-to", "1234567890128"),
                FinancialSaleLine("sale-outside", "2345678901234"));
            await context.SaveChangesAsync();

            var reversal = SaleFinancialReversalPolicy.Create("sale-outside", nonFood);
            context.StockOperations.Add(FinancialCounterMovement(
                "counter-in-period",
                "2345678901234",
                "2030-01-15T12:00:00Z",
                "sale-outside",
                reversal));
            context.StockOperationLines.Add(new StockOperationLineEntity
            {
                OperationId = "counter-in-period",
                LineNumber = 1,
                Ean13 = "2345678901234",
                OperationType = "COUNTER_MOVEMENT",
                SourceEffect = -1,
                InverseEffect = 1
            });
            await context.SaveChangesAsync();
        }

        public async Task SeedFinancialArticlesAsync()
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            context.Articles.AddRange(
                Article("0123456789012", true),
                new ArticleEntity
                {
                    Ean13 = "1234567890128",
                    Type = "food",
                    Name = "Sur place",
                    NameSearchKey = "SUR PLACE",
                    PriceHtCents = 100,
                    IsActive = true,
                    Dlc = "2099-01-15",
                    ConsumptionModes = "onsite"
                },
                new ArticleEntity
                {
                    Ean13 = "2345678901234",
                    Type = "nonFood",
                    Name = "Non alimentaire",
                    NameSearchKey = "NON ALIMENTAIRE",
                    PriceHtCents = 100,
                    IsActive = true,
                    Packaging = "new"
                });
            context.StockPositions.AddRange(
                Position("0123456789012", 2),
                Position("1234567890128", 2),
                Position("2345678901234", 2));
            await context.SaveChangesAsync();
        }

        public async Task<string> SnapshotAsync()
        {
            using var scope = Services.CreateScope();
            var contextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<WarehouseDbContext>>();
            await using var context = await contextFactory.CreateDbContextAsync();
            return await SnapshotAsync(context);
        }

        public async Task<string> ReadFreshSnapshotAsync()
        {
            await using var connection = new SqliteConnection($"Data Source={databasePath}");
            await connection.OpenAsync();
            var options = new DbContextOptionsBuilder<WarehouseDbContext>()
                .UseSqlite(connection)
                .Options;
            await using var context = new WarehouseDbContext(options);
            return await SnapshotAsync(context);
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:Warehouse", $"Data Source={databasePath}");
            if (failHistory)
            {
                builder.ConfigureServices(services =>
                {
                    services.RemoveAll<IHistoryReader>();
                    services.AddScoped<IHistoryReader, ThrowingHistoryReader>();
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

        private static ArticleEntity Article(string ean13, bool isActive)
            => new()
            {
                Ean13 = ean13,
                Type = "food",
                Name = ean13,
                NameSearchKey = ean13,
                PriceHtCents = 100,
                IsActive = isActive,
                Dlc = "2099-01-15",
                ConsumptionModes = "takeaway"
            };

        private static StockPositionEntity Position(string ean13, int quantity)
            => new()
            {
                Ean13 = ean13,
                PhysicalQuantity = quantity,
                Version = 0
            };

        private static StockOperationEntity Operation(
            string id,
            string type,
            string ean13,
            string timestampUtc,
            int previousPhysicalStock = 0,
            int countedQuantity = 0,
            int inventoryDifference = 0,
            int resultingPhysicalStock = 0,
            string? sourceOperationId = null,
            string? sourceOperationType = null,
            string? justification = null,
            int? quantity = null)
            => new()
            {
                Id = id,
                Type = type,
                Ean13 = ean13,
                Quantity = quantity ?? (type.Equals("supply", StringComparison.OrdinalIgnoreCase) ? 5 : 0),
                OccurredAt = timestampUtc,
                PreviousPhysicalStock = previousPhysicalStock,
                CountedQuantity = countedQuantity,
                InventoryDifference = inventoryDifference,
                ResultingPhysicalStock = resultingPhysicalStock,
                TimestampUtc = timestampUtc,
                SourceOperationId = sourceOperationId,
                SourceOperationType = sourceOperationType,
                Justification = justification
            };

        private static StockOperationEntity FinancialSale(
            string id,
            string ean13,
            string timestampUtc,
            SaleFinancialSnapshot snapshot,
            int previousPhysicalStock = 0,
            int resultingPhysicalStock = 0,
            int quantity = 1,
            SaleFinancialSnapshot? payloadSnapshot = null)
        {
            return new()
            {
                Id = id,
                Type = "SALE",
                Ean13 = ean13,
                Quantity = quantity,
                OccurredAt = timestampUtc,
                TimestampUtc = timestampUtc,
                PreviousPhysicalStock = previousPhysicalStock,
                ResultingPhysicalStock = resultingPhysicalStock,
                SaleCommitDataType = SaleFinancialSnapshotSerializer.Type,
                SaleCommitDataPayload = SaleFinancialSnapshotSerializer.Serialize(payloadSnapshot ?? snapshot),
                SaleFinancialContext = snapshot.SaleContext switch
                {
                    SaleContext.Takeaway => "takeaway",
                    SaleContext.OnSite => "onsite",
                    _ => null
                },
                SaleFinancialUnitPriceHtCents = snapshot.UnitPriceHt.Cents,
                SaleFinancialTaxRateCode = snapshot.TaxRate.Code,
                SaleFinancialTaxRateNumerator = snapshot.TaxRate.Numerator,
                SaleFinancialTaxRateDenominator = snapshot.TaxRate.Denominator,
                SaleFinancialAmountHtCents = snapshot.AmountHt.Cents,
                SaleFinancialVatCents = snapshot.Vat.Cents,
                SaleFinancialAmountTtcCents = snapshot.AmountTtc.Cents
            };
        }

        private static StockOperationEntity FinancialCounterMovement(
            string id,
            string ean13,
            string timestampUtc,
            string sourceOperationId,
            SaleFinancialReversal reversal)
            => new()
            {
                Id = id,
                Type = "COUNTER_MOVEMENT",
                Ean13 = ean13,
                OccurredAt = timestampUtc,
                TimestampUtc = timestampUtc,
                SourceOperationId = sourceOperationId,
                SourceOperationType = "SALE",
                Justification = "Période financière",
                SaleCommitDataType = SaleFinancialReversalSerializer.Type,
                SaleCommitDataPayload = SaleFinancialReversalSerializer.Serialize(reversal)
            };

        private static StockOperationLineEntity FinancialSaleLine(
            string operationId,
            string ean13,
            int previousPhysicalStock = 0,
            int resultingPhysicalStock = 0,
            int quantity = 1)
            => new()
            {
                OperationId = operationId,
                LineNumber = 1,
                Ean13 = ean13,
                OperationType = "SALE",
                Quantity = quantity,
                PreviousPhysicalStock = previousPhysicalStock,
                ResultingPhysicalStock = resultingPhysicalStock,
                SourceEffect = -quantity
            };

        private static SaleFinancialSnapshot Snapshot(
            SaleContext? context,
            TaxRate taxRate,
            int vatCents)
            => new(
                context,
                Money.FromCents(100),
                taxRate,
                Money.FromCents(100),
                Money.FromCents(vatCents),
                Money.FromCents(100 + vatCents));

        private static StockOperationLineEntity Line(
            string operationId,
            int lineNumber,
            string ean13,
            string operationType,
            int quantity,
            int previousPhysicalStock = 0,
            int countedQuantity = 0,
            int resultingPhysicalStock = 0,
            int? sourceEffect = null,
            int? inverseEffect = null)
            => new()
            {
                OperationId = operationId,
                LineNumber = lineNumber,
                Ean13 = ean13,
                OperationType = operationType,
                Quantity = quantity,
                PreviousPhysicalStock = previousPhysicalStock,
                CountedQuantity = countedQuantity,
                InventoryDifference = countedQuantity - previousPhysicalStock,
                ResultingPhysicalStock = resultingPhysicalStock,
                SourceEffect = sourceEffect ?? quantity,
                InverseEffect = inverseEffect ?? 0
            };

        private static async Task<string> SnapshotAsync(WarehouseDbContext context)
        {
            var articles = await context.Articles.AsNoTracking().OrderBy(entity => entity.Ean13).ToListAsync();
            var positions = await context.StockPositions.AsNoTracking().OrderBy(entity => entity.Ean13).ToListAsync();
            var operations = await context.StockOperations.AsNoTracking().OrderBy(entity => entity.Id).ToListAsync();
            var lines = await context.StockOperationLines.AsNoTracking().OrderBy(entity => entity.OperationId).ThenBy(entity => entity.LineNumber).ToListAsync();
            var lifecycle = await context.ArticleLifecycleHistory.AsNoTracking().OrderBy(entity => entity.FactId).ToListAsync();
            return JsonSerializer.Serialize(new
            {
                articles,
                positions,
                operations,
                lines,
                lifecycle
            });
        }
    }

    private sealed class ThrowingHistoryReader : IHistoryReader
    {
        public ValueTask<HistoryReadResult> ReadAsync(
            HistoryQuery query,
            CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("controlled history failure");
    }

    private sealed class HistoryDbContextFactory(
        string connectionString,
        DbCommandInterceptor? interceptor = null) : IDbContextFactory<WarehouseDbContext>
    {
        public WarehouseDbContext CreateDbContext()
            => Create();

        public Task<WarehouseDbContext> CreateDbContextAsync(CancellationToken cancellationToken = default)
            => Task.FromResult(Create());

        private WarehouseDbContext Create()
        {
            var options = new DbContextOptionsBuilder<WarehouseDbContext>()
                .UseSqlite(connectionString);
            if (interceptor is not null)
            {
                options.AddInterceptors(interceptor);
            }

            return new WarehouseDbContext(options.Options);
        }
    }

    private sealed class InjectLifecycleFactBeforeOperationsQuery(string databasePath) : DbCommandInterceptor
    {
        private bool writerAttempted;

        public bool WriterCommitted { get; private set; }

        public bool WriterBlocked { get; private set; }

        public override InterceptionResult<DbDataReader> ReaderExecuting(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result)
        {
            InjectIfOperationsQuery(command);
            return result;
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            InjectIfOperationsQuery(command);
            return ValueTask.FromResult(result);
        }

        private void InjectIfOperationsQuery(DbCommand command)
        {
            if (writerAttempted || !command.CommandText.Contains("StockOperations", StringComparison.Ordinal))
            {
                return;
            }
            writerAttempted = true;

            using var connection = new SqliteConnection($"Data Source={databasePath};Default Timeout=1");
            connection.DefaultTimeout = 1;
            connection.Open();
            var options = new DbContextOptionsBuilder<WarehouseDbContext>()
                .UseSqlite(connection)
                .Options;
            using var context = new WarehouseDbContext(options);
            context.Database.SetCommandTimeout(1);
            context.ArticleLifecycleHistory.Add(new ArticleLifecycleHistoryEntity
            {
                FactId = "fact_concurrent_catalogue_01J00000000000000000000000",
                Ean13 = "0123456789012",
                PreviousStatus = "active",
                NextStatus = "archived",
                OccurredAt = "2030-01-15T12:00:00Z",
                Kind = "lifecycle"
            });
            try
            {
                context.SaveChanges();
                WriterCommitted = true;
            }
            catch (DbUpdateException exception) when (exception.InnerException is SqliteException
            {
                SqliteErrorCode: 5 or 6
            })
            {
                WriterBlocked = true;
            }
        }

        public void CommitPendingFact()
        {
            using var connection = new SqliteConnection($"Data Source={databasePath}");
            connection.Open();
            var options = new DbContextOptionsBuilder<WarehouseDbContext>()
                .UseSqlite(connection)
                .Options;
            using var context = new WarehouseDbContext(options);
            context.ArticleLifecycleHistory.Add(new ArticleLifecycleHistoryEntity
            {
                FactId = "fact_concurrent_catalogue_01J00000000000000000000000",
                Ean13 = "0123456789012",
                PreviousStatus = "active",
                NextStatus = "archived",
                OccurredAt = "2030-01-15T12:00:00Z",
                Kind = "lifecycle"
            });
            context.SaveChanges();
        }
    }
}
