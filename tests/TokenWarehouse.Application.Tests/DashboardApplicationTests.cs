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

        var result = await new DashboardApplication(new FakeDashboardSource(rows)).ReadAsync(AllQuery());

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

        var result = await new DashboardApplication(new FakeDashboardSource([row])).ReadAsync(AllQuery());

        Assert.Equal(DashboardReadStatus.Success, result.Status);
        Assert.Equal(7, result.View!.StockByArticle[0].PhysicalStock);
        Assert.Equal(2, result.View.StockByArticle[0].SellableStock);
        Assert.Equal(5, result.View.StockByArticle[0].NonSellableStock);
        Assert.Equal(StockAvailability.Available, result.View.StockByArticle[0].Availability);
        Assert.Null(result.View.StockByArticle[0].Reason);
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

        var result = await new DashboardApplication(new FakeDashboardSource([invalid])).ReadAsync(AllQuery());

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

        var query = new DashboardQuery(
            new WarehouseDateRange(new DateOnly(2030, 3, 1), new DateOnly(2030, 3, 31)),
            new DashboardArticleSelection(ArticleType.Food, ConsumptionMode.OnSite, null));

        var result = await new DashboardApplication(new FakeDashboardSource(rows)).ReadAsync(query);

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

        var result = await new DashboardApplication(new FakeDashboardSource([row])).ReadAsync(
            new DashboardQuery(
                new WarehouseDateRange(new DateOnly(2030, 3, 1), new DateOnly(2030, 3, 31)),
                new DashboardArticleSelection(ArticleType.Food, null, PackagingCondition.New)));

        Assert.Equal(DashboardReadStatus.Success, result.Status);
        Assert.Empty(result.View!.StockByArticle);
        Assert.Equal((0, 0, 0), (
            result.View.Kpis.PhysicalStock,
            result.View.Kpis.SellableStock,
            result.View.Kpis.NonSellableStock));
    }

    [Fact]
    public void Uses_the_warehouse_date_for_the_current_month()
    {
        var calendar = new WarehouseCalendar(new FixedClock(new DateTimeOffset(2030, 3, 15, 23, 30, 0, TimeSpan.Zero)));

        Assert.Equal(new DateOnly(2030, 3, 15), calendar.WarehouseDate);
        Assert.Equal(
            new WarehouseDateRange(new DateOnly(2030, 3, 1), new DateOnly(2030, 3, 31)),
            calendar.CurrentMonth);
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
        IReadOnlyList<ConsumptionMode>? consumptionModes = null)
    {
        Assert.True(Ean13.TryCreate(ean13, out var parsed));
        return new(
            parsed,
            name,
            type,
            isActive,
            type == ArticleType.Food ? new DateOnly(2030, 1, 15) : null,
            type == ArticleType.Food ? consumptionModes ?? [ConsumptionMode.Takeaway] : [],
            type == ArticleType.NonFood ? PackagingCondition.New : null,
            physicalStock,
            sellableStock,
            availability,
            reason);
    }

    private sealed class FakeDashboardSource(IReadOnlyList<StockPositionView> rows) : ICurrentDashboardReadSource
    {
        public Task<IReadOnlyList<StockPositionView>> ReadAsync(
            DashboardQuery query,
            CancellationToken cancellationToken = default)
            => Task.FromResult(rows);
    }

    private static DashboardQuery AllQuery()
        => new(
            new WarehouseDateRange(new DateOnly(2030, 1, 1), new DateOnly(2030, 1, 31)),
            new DashboardArticleSelection(null, null, null));

    private sealed class FixedClock(DateTimeOffset now) : IClock
    {
        public DateTimeOffset UtcNow => now;
    }
}
