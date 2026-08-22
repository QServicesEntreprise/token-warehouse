using TokenWarehouse.Application;
using TokenWarehouse.Domain;
using Xunit;

namespace TokenWarehouse.Application.Tests;

public sealed class DashboardApplicationTests
{
    [Fact]
    public async Task Assembles_current_kpis_alerts_and_rows_from_the_stock_contract()
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

        var result = await new DashboardApplication(new FakeStockContract(
            new StockReadResult(StockReadStatus.Success, rows, null, []))).ReadAsync();

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
        Assert.Equal("ARCHIVED", archived.LifecycleStatus);
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

        var result = await new DashboardApplication(new FakeStockContract(
            new StockReadResult(StockReadStatus.Success, [row], null, []))).ReadAsync();

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

        var result = await new DashboardApplication(new FakeStockContract(
            new StockReadResult(StockReadStatus.Success, [invalid], null, []))).ReadAsync();

        Assert.Equal(DashboardReadStatus.PersistenceFailed, result.Status);
        Assert.Null(result.View);
    }

    private static StockPositionView View(
        string ean13,
        string name,
        ArticleType type,
        bool isActive,
        int physicalStock,
        int sellableStock,
        StockAvailability availability,
        SellabilityReason? reason)
    {
        Assert.True(Ean13.TryCreate(ean13, out var parsed));
        return new(
            parsed,
            name,
            type,
            isActive,
            type == ArticleType.Food ? new DateOnly(2030, 1, 15) : null,
            type == ArticleType.Food ? [ConsumptionMode.Takeaway] : [],
            type == ArticleType.NonFood ? PackagingCondition.New : null,
            physicalStock,
            sellableStock,
            availability,
            reason);
    }

    private sealed class FakeStockContract(StockReadResult result) : IStockPositionReadContract
    {
        public Task<StockReadResult> ListAsync(CancellationToken cancellationToken = default)
            => Task.FromResult(result);

        public Task<StockReadResult> GetAsync(string ean13, CancellationToken cancellationToken = default)
            => Task.FromResult(result);
    }
}
