using TokenWarehouse.Application;
using TokenWarehouse.Domain;
using Xunit;

namespace TokenWarehouse.Application.Tests;

public sealed class DashboardApplicationTests
{
    [Fact]
    public async Task Assembles_current_kpis_alerts_and_rows_from_the_dashboard_read_source()
    {
        var rows = new[]
        {
            View("0123456789012", "Alimentaire aux deux modes", ArticleType.Food, true, 5, 5,
                StockAvailability.Available, null),
            View("1234567890128", "DLC dépassée", ArticleType.Food, true, 7, 0,
                StockAvailability.NotSellable, SellabilityReason.DlcExpired),
            View("2345678901234", "Article archivé", ArticleType.NonFood, false, 4, 0,
                StockAvailability.NotSellable, SellabilityReason.Archived),
            View("3456789012340", "Packaging invendable", ArticleType.NonFood, true, 3, 0,
                StockAvailability.NotSellable, SellabilityReason.UnsellablePackaging),
            View("4567890123456", "Article vendable", ArticleType.NonFood, true, 8, 8,
                StockAvailability.Available, null),
            View("5678901234562", "Article sans position", ArticleType.Food, true, 0, 0,
                StockAvailability.OutOfStock, null),
        };

        var result = await new DashboardApplication(new FakeDashboardSource(rows), Calendar()).ReadAsync(AllQuery());

        Assert.Equal(DashboardReadStatus.Success, result.Status);
        Assert.NotNull(result.View);
        Assert.Equal((27, 13, 14), (
            result.View!.Kpis.PhysicalStock,
            result.View.Kpis.SellableStock,
            result.View.Kpis.NonSellableStock));
        Assert.Equal(
            ["0123456789012", "1234567890128", "2345678901234", "3456789012340", "4567890123456", "5678901234562"],
            result.View.StockByArticle.Select(row => row.Ean13));
        Assert.Equal(["5678901234562"], result.View.Alerts.OutOfStock.Select(row => row.Ean13));
        Assert.Equal(
            ["1234567890128", "2345678901234", "3456789012340"],
            result.View.Alerts.NotSellable.Select(row => row.Ean13));

        var archived = result.View.StockByArticle.Single(row => row.Ean13 == "2345678901234");
        Assert.Equal(ArticleLifecycleStatus.Archived, archived.LifecycleStatus);
        Assert.Equal(4, archived.PhysicalStock);
        Assert.Equal(0, archived.SellableStock);
        Assert.Equal(4, archived.NonSellableStock);
        Assert.Equal(SellabilityReason.Archived, archived.Reason);
    }

    [Fact]
    public async Task Preserves_a_partial_stock_contract_and_only_calculates_non_sellable_stock()
    {
        var row = View(
            "0123456789012",
            "Stock partiellement vendable",
            ArticleType.Food,
            true,
            7,
            2,
            StockAvailability.Available,
            null);

        var result = await new DashboardApplication(new FakeDashboardSource([row]), Calendar()).ReadAsync(AllQuery());

        Assert.Equal(DashboardReadStatus.Success, result.Status);
        Assert.Equal(7, result.View!.StockByArticle[0].PhysicalStock);
        Assert.Equal(2, result.View.StockByArticle[0].SellableStock);
        Assert.Equal(5, result.View.StockByArticle[0].NonSellableStock);
        Assert.Equal(StockAvailability.Available, result.View.StockByArticle[0].Availability);
        Assert.Null(result.View.StockByArticle[0].Reason);
    }

    [Fact]
    public async Task Adds_signed_financial_summary_using_historical_context_and_period()
    {
        var rows = new[]
        {
            View("0123456789012", "À emporter", ArticleType.Food, true, 1, 1,
                StockAvailability.Available, null, [ConsumptionMode.Takeaway]),
            View("1234567890128", "Sur place", ArticleType.Food, true, 1, 1,
                StockAvailability.Available, null, [ConsumptionMode.OnSite]),
            View("2345678901234", "Non alimentaire", ArticleType.NonFood, true, 1, 1,
                StockAvailability.Available, null, packaging: PackagingCondition.New)
        };
        var facts = new[]
        {
            Fact("sale-takeaway", "0123456789012", "2030-01-10T10:00:00Z", TaxRate.Takeaway,
                SaleContext.Takeaway, 1000, 55, 1055),
            Fact("sale-onsite", "1234567890128", "2030-01-10T11:00:00Z", TaxRate.OnSite,
                SaleContext.OnSite, 1000, 100, 1100),
            Fact("sale-non-food", "2345678901234", "2030-01-10T12:00:00Z", TaxRate.NonFood,
                null, 1000, 200, 1200),
            Fact("counter-onsite", "1234567890128", "2030-01-20T10:00:00Z", TaxRate.OnSite,
                SaleContext.OnSite, -1000, -100, -1100, "sale-onsite")
        };
        var application = new DashboardApplication(
            new FakeDashboardSource(rows, financialFacts: facts),
            Calendar());

        var all = await application.ReadAsync(AllQuery());
        var onsite = await application.ReadAsync(
            new DashboardQueryRequest("2030-01-01", "2030-01-31", "food", "onsite", null));
        var correctionOnly = await application.ReadAsync(
            new DashboardQueryRequest("2030-01-20", "2030-01-20", null, null, null));

        Assert.Equal((2000, 255, 2255), (
            all.View!.Financial!.RevenueHt.Cents,
            all.View.Financial.VatCollected.Cents,
            all.View.Financial.RevenueTtc.Cents));
        Assert.Equal(
            [(1000, 55, 1055), (0, 0, 0), (1000, 200, 1200)],
            all.View.Financial!.ByTaxRate.Select(line => (
                line.AmountHt.Cents,
                line.Vat.Cents,
                line.AmountTtc.Cents)));
        Assert.Equal((0, 0, 0), (
            onsite.View!.Financial!.RevenueHt.Cents,
            onsite.View.Financial.VatCollected.Cents,
            onsite.View.Financial.RevenueTtc.Cents));
        Assert.Equal(3, onsite.View.Financial!.ByTaxRate.Count);
        Assert.Equal((-1000, -100, -1100), (
            correctionOnly.View!.Financial!.RevenueHt.Cents,
            correctionOnly.View.Financial.VatCollected.Cents,
            correctionOnly.View.Financial.RevenueTtc.Cents));
    }

    [Fact]
    public async Task Uses_historical_financial_mode_when_current_article_modes_changed()
    {
        var changedModeArticle = View(
            "0123456789012",
            "Mode actuel à emporter",
            ArticleType.Food,
            true,
            1,
            1,
            StockAvailability.Available,
            null,
            [ConsumptionMode.Takeaway]);
        var historicalFact = Fact(
            "sale-historical-onsite",
            "0123456789012",
            "2030-01-10T10:00:00Z",
            TaxRate.OnSite,
            SaleContext.OnSite,
            1000,
            100,
            1100);
        var query = new DashboardQueryRequest(
            "2030-01-01",
            "2030-01-31",
            "food",
            "onsite",
            null);

        var alone = await new DashboardApplication(
            new FakeDashboardSource([changedModeArticle], financialFacts: [historicalFact]),
            Calendar()).ReadAsync(query);

        Assert.Equal(DashboardReadStatus.Success, alone.Status);
        Assert.Empty(alone.View!.StockByArticle);
        Assert.Equal((1000, 100, 1100), (
            alone.View.Financial!.RevenueHt.Cents,
            alone.View.Financial.VatCollected.Cents,
            alone.View.Financial.RevenueTtc.Cents));

        var currentlyOnsiteArticle = View(
            "1234567890128",
            "Mode actuel sur place",
            ArticleType.Food,
            true,
            1,
            1,
            StockAvailability.Available,
            null,
            [ConsumptionMode.OnSite]);
        var alongside = await new DashboardApplication(
            new FakeDashboardSource(
                [changedModeArticle, currentlyOnsiteArticle],
                financialFacts: [historicalFact]),
            Calendar()).ReadAsync(query);

        Assert.Equal(DashboardReadStatus.Success, alongside.Status);
        Assert.Equal(["1234567890128"], alongside.View!.StockByArticle.Select(row => row.Ean13));
        Assert.Equal((1000, 100, 1100), (
            alongside.View.Financial!.RevenueHt.Cents,
            alongside.View.Financial.VatCollected.Cents,
            alongside.View.Financial.RevenueTtc.Cents));
    }

    [Fact]
    public async Task Rejects_an_invalid_stock_quantity_instead_of_clamping_it()
    {
        var invalid = View(
            "0123456789012",
            "Stock incohérent",
            ArticleType.Food,
            true,
            2,
            3,
            StockAvailability.Available,
            null);

        var result = await new DashboardApplication(new FakeDashboardSource([invalid]), Calendar()).ReadAsync(AllQuery());

        Assert.Equal(DashboardReadStatus.PersistenceFailed, result.Status);
        Assert.Null(result.View);
    }

    [Fact]
    public async Task Applies_the_period_and_all_article_dimensions_as_an_intersection()
    {
        var rows = new[]
        {
            View("0123456789012", "Alimentaire double mode", ArticleType.Food, true, 5, 5,
                StockAvailability.Available, null, [ConsumptionMode.Takeaway, ConsumptionMode.OnSite]),
            View("1234567890128", "Alimentaire à emporter", ArticleType.Food, true, 7, 0,
                StockAvailability.NotSellable, SellabilityReason.DlcExpired),
            View("4567890123456", "Neuf", ArticleType.NonFood, true, 8, 8,
                StockAvailability.Available, null)
        };

        var result = await new DashboardApplication(new FakeDashboardSource(rows), Calendar()).ReadAsync(
            new DashboardQueryRequest(
                "2030-03-01",
                "2030-03-31",
                "food",
                "onsite",
                null));

        Assert.Equal(DashboardReadStatus.Success, result.Status);
        Assert.Equal(["0123456789012"], result.View!.StockByArticle.Select(row => row.Ean13));
        Assert.Equal((5, 5, 0), (
            result.View.Kpis.PhysicalStock,
            result.View.Kpis.SellableStock,
            result.View.Kpis.NonSellableStock));
    }

    [Fact]
    public async Task Keeps_a_valid_non_applicable_combination_empty()
    {
        var row = View("4567890123456", "Neuf", ArticleType.NonFood, true, 8, 8,
            StockAvailability.Available, null);

        var result = await new DashboardApplication(new FakeDashboardSource([row]), Calendar()).ReadAsync(
            new DashboardQueryRequest(
                "2030-03-01",
                "2030-03-31",
                "food",
                null,
                "new"));

        Assert.Equal(DashboardReadStatus.Success, result.Status);
        Assert.Empty(result.View!.StockByArticle);
        Assert.Equal((0, 0, 0), (
            result.View.Kpis.PhysicalStock,
            result.View.Kpis.SellableStock,
            result.View.Kpis.NonSellableStock));
        Assert.Null(result.View.Financial);
    }

    [Fact]
    public void Uses_the_warehouse_date_for_the_current_month()
    {
        var calendar = new WarehouseCalendar(
            new FixedClock(new DateTimeOffset(2030, 3, 15, 23, 30, 0, TimeSpan.Zero)),
            TimeZoneInfo.Utc);

        Assert.Equal(new DateOnly(2030, 3, 15), calendar.WarehouseDate);
        Assert.Equal(
            new WarehouseDateRange(new DateOnly(2030, 3, 1), new DateOnly(2030, 3, 31)),
            calendar.CurrentMonth);
    }

    [Fact]
    public void Uses_one_configured_warehouse_calendar_at_a_local_midnight_boundary()
    {
        var instant = new DateTimeOffset(2030, 3, 31, 23, 30, 0, TimeSpan.Zero);
        var warehouseTimeZone = TimeZoneInfo.CreateCustomTimeZone(
            "Warehouse",
            TimeSpan.FromHours(2),
            "Warehouse",
            "Warehouse");
        var calendar = new WarehouseCalendar(new FixedClock(instant), warehouseTimeZone);

        Assert.Equal(new DateOnly(2030, 4, 1), calendar.WarehouseDate);
        Assert.Equal(
            new WarehouseDateRange(new DateOnly(2030, 4, 1), new DateOnly(2030, 4, 30)),
            calendar.CurrentMonth);
        Assert.Equal(calendar.WarehouseDate, calendar.ToWarehouseDate(instant));
        var period = calendar.ToUtcPeriod(
            new WarehouseDateRange(new DateOnly(2030, 4, 1), new DateOnly(2030, 4, 1)));
        Assert.Equal(new DateTimeOffset(2030, 3, 31, 22, 0, 0, TimeSpan.Zero), period.FromUtc);
        Assert.Equal(new DateTimeOffset(2030, 4, 1, 22, 0, 0, TimeSpan.Zero), period.ToUtc);
    }

    [Fact]
    public async Task Accepts_equal_period_bounds_and_passes_the_normalized_query_to_the_read_source()
    {
        var source = new FakeDashboardSource([]);
        var result = await new DashboardApplication(source, Calendar()).ReadAsync(
            new DashboardQueryRequest("2030-03-15", "2030-03-15", "all", "all", "all"));

        Assert.Equal(DashboardReadStatus.Success, result.Status);
        Assert.Equal(new DateOnly(2030, 3, 15), source.LastQuery!.Period.From);
        Assert.Equal(new DateOnly(2030, 3, 15), source.LastQuery.Period.To);
        Assert.Null(source.LastQuery.Selection.Type);
        Assert.Null(source.LastQuery.Selection.Mode);
        Assert.Null(source.LastQuery.Selection.Packaging);
    }

    [Fact]
    public async Task Rejects_a_reversed_period_at_the_application_seam_without_reading_sources()
    {
        var source = new FakeDashboardSource([]);
        var result = await new DashboardApplication(source, Calendar()).ReadAsync(
            new DashboardQueryRequest("2030-03-16", "2030-03-15", null, null, null));

        Assert.Equal(DashboardReadStatus.ValidationFailed, result.Status);
        Assert.Equal("dashboard.reversed_period", result.Errors[0].Code);
        Assert.Equal(["from", "to"], result.Errors.Select(error => error.Field));
        Assert.Equal(0, source.Calls);
    }

    [Theory]
    [InlineData(null, "2030-03-15", "dashboard.missing_period", "from")]
    [InlineData("2030-03-15", null, "dashboard.missing_period", "to")]
    [InlineData("2030-02-30", "2030-03-15", "dashboard.invalid_date", "from")]
    [InlineData("2030-03-15", "2030-02-30", "dashboard.invalid_date", "to")]
    public async Task Rejects_missing_or_invalid_period_bounds_at_the_application_seam(
        string? from,
        string? to,
        string code,
        string field)
    {
        var source = new FakeDashboardSource([]);
        var result = await new DashboardApplication(source, Calendar()).ReadAsync(
            new DashboardQueryRequest(from, to, null, null, null));

        Assert.Equal(DashboardReadStatus.ValidationFailed, result.Status);
        Assert.Contains(result.Errors, error => error.Code == code && error.Field == field);
        Assert.Equal(0, source.Calls);
    }

    [Fact]
    public void Converts_instants_with_the_warehouse_calendar_instead_of_using_the_input_offset()
    {
        var calendar = new WarehouseCalendar(
            new FixedClock(new DateTimeOffset(2030, 3, 15, 10, 0, 0, TimeSpan.Zero)),
            TimeZoneInfo.CreateCustomTimeZone(
                "Warehouse",
                TimeSpan.FromHours(2),
                "Warehouse",
                "Warehouse"));

        Assert.Equal(
            new DateOnly(2030, 3, 16),
            calendar.ToWarehouseDate(new DateTimeOffset(2030, 3, 15, 23, 30, 0, TimeSpan.Zero)));
    }

    [Fact]
    public async Task Aggregates_accepted_supply_and_sale_facts_into_continuous_filtered_days()
    {
        var rows = new[]
        {
            View("0123456789012", "A", ArticleType.Food, true, 5, 5,
                StockAvailability.Available, null, [ConsumptionMode.Takeaway, ConsumptionMode.OnSite]),
            View("1234567890128", "B", ArticleType.Food, true, 2, 2,
                StockAvailability.Available, null, [ConsumptionMode.Takeaway]),
            View("2345678901234", "C", ArticleType.NonFood, true, 7, 7,
                StockAvailability.Available, null),
            View("3456789012340", "D", ArticleType.NonFood, false, 4, 0,
                StockAvailability.NotSellable, SellabilityReason.Archived,
                packaging: PackagingCondition.Refurbished)
        };
        var operations = new[]
        {
            Operation("bulk", StockOperationType.Supply, "0123456789012", "2030-03-10T22:30:00Z", null,
                Line(1, "0123456789012", 5),
                Line(2, "1234567890128", 3),
                Line(3, "2345678901234", 7),
                Line(4, "3456789012340", 4)),
            Operation("supply", StockOperationType.Supply, "0123456789012", "2030-03-11T22:30:00Z", null,
                Line(1, "0123456789012", 2)),
            Operation("sale-b", StockOperationType.Sale, "1234567890128", "2030-03-09T22:30:00Z", SaleContext.Takeaway,
                Line(1, "1234567890128", 2)),
            Operation("sale-takeaway", StockOperationType.Sale, "0123456789012", "2030-03-11T23:30:00Z", SaleContext.Takeaway,
                Line(1, "0123456789012", 1)),
            Operation("sale-onsite", StockOperationType.Sale, "0123456789012", "2030-03-12T00:30:00Z", SaleContext.OnSite,
                Line(1, "0123456789012", 4)),
            Operation("inventory", StockOperationType.Inventory, "0123456789012", "2030-03-12T23:30:00Z", null,
                Line(1, "0123456789012", 99)),
            Operation("counter", StockOperationType.CounterMovement, "0123456789012", "2030-03-10T23:00:00Z", null,
                Line(1, "0123456789012", 99))
        };
        var calendar = new WarehouseCalendar(
            new FixedClock(new DateTimeOffset(2030, 3, 15, 10, 0, 0, TimeSpan.Zero)),
            TimeZoneInfo.CreateCustomTimeZone("Warehouse", TimeSpan.FromHours(2), "Warehouse", "Warehouse"));
        var application = new DashboardApplication(
            new FakeDashboardSource(rows, operations),
            calendar);

        var result = await application.ReadAsync(
            new DashboardQueryRequest("2030-03-10", "2030-03-13", null, null, null));

        Assert.Equal(DashboardReadStatus.Success, result.Status);
        Assert.Equal(
            [
                new DashboardFlowDayView(new DateOnly(2030, 3, 10), 0, 2),
                new DashboardFlowDayView(new DateOnly(2030, 3, 11), 19, 0),
                new DashboardFlowDayView(new DateOnly(2030, 3, 12), 2, 5),
                new DashboardFlowDayView(new DateOnly(2030, 3, 13), 0, 0)
            ],
            result.View!.FlowsByDay);

        var filtered = await application.ReadAsync(
            new DashboardQueryRequest("2030-03-10", "2030-03-13", "food", "onsite", null));

        Assert.Equal(
            [
                new DashboardFlowDayView(new DateOnly(2030, 3, 10), 0, 0),
                new DashboardFlowDayView(new DateOnly(2030, 3, 11), 5, 0),
                new DashboardFlowDayView(new DateOnly(2030, 3, 12), 2, 4),
                new DashboardFlowDayView(new DateOnly(2030, 3, 13), 0, 0)
            ],
            filtered.View!.FlowsByDay);

        async Task AssertFlowsAsync(
            string? type,
            string? mode,
            string? packaging,
            params DashboardFlowDayView[] expected)
        {
            var read = await application.ReadAsync(
                new DashboardQueryRequest("2030-03-10", "2030-03-13", type, mode, packaging));

            Assert.Equal(DashboardReadStatus.Success, read.Status);
            Assert.Equal(expected, read.View!.FlowsByDay);
        }

        await AssertFlowsAsync(
            "nonFood",
            null,
            null,
            new DashboardFlowDayView(new DateOnly(2030, 3, 10), 0, 0),
            new DashboardFlowDayView(new DateOnly(2030, 3, 11), 11, 0),
            new DashboardFlowDayView(new DateOnly(2030, 3, 12), 0, 0),
            new DashboardFlowDayView(new DateOnly(2030, 3, 13), 0, 0));
        await AssertFlowsAsync(
            null,
            null,
            "new",
            new DashboardFlowDayView(new DateOnly(2030, 3, 10), 0, 0),
            new DashboardFlowDayView(new DateOnly(2030, 3, 11), 7, 0),
            new DashboardFlowDayView(new DateOnly(2030, 3, 12), 0, 0),
            new DashboardFlowDayView(new DateOnly(2030, 3, 13), 0, 0));
        await AssertFlowsAsync(
            null,
            null,
            "refurbished",
            new DashboardFlowDayView(new DateOnly(2030, 3, 10), 0, 0),
            new DashboardFlowDayView(new DateOnly(2030, 3, 11), 4, 0),
            new DashboardFlowDayView(new DateOnly(2030, 3, 12), 0, 0),
            new DashboardFlowDayView(new DateOnly(2030, 3, 13), 0, 0));
        await AssertFlowsAsync(
            "food",
            null,
            "new",
            new DashboardFlowDayView(new DateOnly(2030, 3, 10), 0, 0),
            new DashboardFlowDayView(new DateOnly(2030, 3, 11), 0, 0),
            new DashboardFlowDayView(new DateOnly(2030, 3, 12), 0, 0),
            new DashboardFlowDayView(new DateOnly(2030, 3, 13), 0, 0));
        await AssertFlowsAsync(
            "nonFood",
            "takeaway",
            null,
            new DashboardFlowDayView(new DateOnly(2030, 3, 10), 0, 0),
            new DashboardFlowDayView(new DateOnly(2030, 3, 11), 0, 0),
            new DashboardFlowDayView(new DateOnly(2030, 3, 12), 0, 0),
            new DashboardFlowDayView(new DateOnly(2030, 3, 13), 0, 0));

        var currentCatalogueRows = rows
            .Select(row => row.Ean13.Value == "0123456789012"
                ? row with { ConsumptionModes = [ConsumptionMode.Takeaway] }
                : row)
            .ToArray();
        var historicalContextApplication = new DashboardApplication(
            new FakeDashboardSource(currentCatalogueRows, operations),
            calendar);

        var historicalContext = await historicalContextApplication.ReadAsync(
            new DashboardQueryRequest("2030-03-10", "2030-03-13", "food", "onsite", null));

        Assert.Equal(
            [
                new DashboardFlowDayView(new DateOnly(2030, 3, 10), 0, 0),
                new DashboardFlowDayView(new DateOnly(2030, 3, 11), 0, 0),
                new DashboardFlowDayView(new DateOnly(2030, 3, 12), 0, 4),
                new DashboardFlowDayView(new DateOnly(2030, 3, 13), 0, 0)
            ],
            historicalContext.View!.FlowsByDay);
    }

    private static StockPositionView View(
        string ean13,
        string name,
        ArticleType type,
        bool isActive,
        int physicalStock,
        int sellableStock,
        StockAvailability availability,
        SellabilityReason? reason,
        IReadOnlyList<ConsumptionMode>? consumptionModes = null,
        PackagingCondition? packaging = null)
    {
        Assert.True(Ean13.TryCreate(ean13, out var parsed));
        return new(
            parsed,
            name,
            type,
            isActive,
            type == ArticleType.Food ? new DateOnly(2030, 1, 15) : null,
            type == ArticleType.Food ? consumptionModes ?? [ConsumptionMode.Takeaway] : [],
            type == ArticleType.NonFood ? packaging ?? PackagingCondition.New : null,
            physicalStock,
            sellableStock,
            availability,
            reason);
    }

    private static SaleFinancialFact Fact(
        string operationId,
        string ean13,
        string timestamp,
        TaxRate taxRate,
        SaleContext? saleContext,
        int amountHt,
        int vat,
        int amountTtc,
        string? sourceOperationId = null)
        => new(
            operationId,
            sourceOperationId is null ? SaleFinancialFactType.Sale : SaleFinancialFactType.CounterMovement,
            DateTimeOffset.Parse(timestamp),
            Ean13.TryCreate(ean13, out var parsed) ? parsed : throw new InvalidOperationException(),
            1,
            Money.FromCents(1000),
            saleContext,
            taxRate,
            Money.FromCents(amountHt),
            Money.FromCents(vat),
            Money.FromCents(amountTtc),
            sourceOperationId,
            sourceOperationId is null ? null : "Correction");

    private sealed class FakeDashboardSource(
        IReadOnlyList<StockPositionView> rows,
        IReadOnlyList<StockOperationReadView>? operations = null,
        IReadOnlyList<SaleFinancialFact>? financialFacts = null) : ICurrentDashboardReadSource
    {
        private readonly DashboardReadSnapshot snapshot = new(rows, operations ?? [])
        {
            FinancialFacts = financialFacts ?? []
        };

        public int Calls { get; private set; }

        public DashboardQuery? LastQuery { get; private set; }

        public Task<DashboardReadSnapshot> ReadAsync(
            DashboardQuery query,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            LastQuery = query;
            return Task.FromResult(snapshot);
        }
    }

    private static StockOperationReadView Operation(
        string id,
        StockOperationType type,
        string ean13,
        string timestamp,
        SaleContext? saleContext,
        params StockOperationLineReadView[] lines)
        => new(
            id,
            type,
            ean13,
            lines.Sum(line => line.Quantity),
            DateTimeOffset.Parse(timestamp),
            null,
            null,
            null,
            lines,
            saleContext);

    private static StockOperationLineReadView Line(int lineNumber, string ean13, int quantity)
        => new(lineNumber, ean13, quantity, 0, 0, 0, 0, quantity, 0);

    private static DashboardQueryRequest AllQuery()
        => new("2030-01-01", "2030-01-31", null, null, null);

    private static IWarehouseCalendar Calendar()
        => new WarehouseCalendar(
            new FixedClock(new DateTimeOffset(2030, 1, 15, 10, 0, 0, TimeSpan.Zero)),
            TimeZoneInfo.Utc);

    private sealed class FixedClock(DateTimeOffset now) : IClock
    {
        public DateTimeOffset UtcNow => now;
    }
}
