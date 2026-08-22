using TokenWarehouse.Domain;

namespace TokenWarehouse.Application;

public sealed record DashboardKpiView(
    int PhysicalStock,
    int SellableStock,
    int NonSellableStock);

public sealed record DashboardStockLineView(
    string Ean13,
    string Name,
    ArticleType ArticleType,
    ArticleLifecycleStatus LifecycleStatus,
    int PhysicalStock,
    int SellableStock,
    int NonSellableStock,
    StockAvailability Availability,
    SellabilityReason? Reason);

public sealed record DashboardAlertsView(
    IReadOnlyList<DashboardStockLineView> OutOfStock,
    IReadOnlyList<DashboardStockLineView> NotSellable);

public sealed record CurrentDashboardView(
    DashboardKpiView Kpis,
    DashboardAlertsView Alerts,
    IReadOnlyList<DashboardStockLineView> StockByArticle);

public enum DashboardReadStatus
{
    Success,
    PersistenceFailed
}

public sealed record DashboardReadResult(
    DashboardReadStatus Status,
    CurrentDashboardView? View);

public interface IReadCurrentDashboardUseCase
{
    Task<DashboardReadResult> ReadAsync(CancellationToken cancellationToken = default);
}

public interface ICurrentDashboardReadSource
{
    Task<IReadOnlyList<StockPositionView>> ReadAsync(CancellationToken cancellationToken = default);
}

public sealed class DashboardApplication(ICurrentDashboardReadSource readSource)
    : IReadCurrentDashboardUseCase
{
    public async Task<DashboardReadResult> ReadAsync(
        CancellationToken cancellationToken = default)
    {
        try
        {
            var rows = (await readSource.ReadAsync(cancellationToken))
                .OrderBy(position => position.Ean13.Value, StringComparer.Ordinal)
                .Select(ToLine)
                .ToArray();

            if (rows.GroupBy(row => row.Ean13, StringComparer.Ordinal).Any(group => group.Count() > 1))
            {
                return Failure();
            }

            var physicalStock = rows.Sum(row => row.PhysicalStock);
            var sellableStock = rows.Sum(row => row.SellableStock);
            var view = new CurrentDashboardView(
                new DashboardKpiView(
                    physicalStock,
                    sellableStock,
                    physicalStock - sellableStock),
                new DashboardAlertsView(
                    rows
                        .Where(row => row.Availability == StockAvailability.OutOfStock
                            && row.LifecycleStatus == ArticleLifecycleStatus.Active
                            && row.PhysicalStock == 0
                            && row.SellableStock == 0)
                        .ToArray(),
                    rows
                        .Where(row => row.Availability == StockAvailability.NotSellable
                            && row.PhysicalStock > 0
                            && row.SellableStock == 0)
                        .ToArray()),
                rows);

            return new(DashboardReadStatus.Success, view);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return Failure();
        }
    }

    private static DashboardStockLineView ToLine(StockPositionView position)
    {
        if (position.PhysicalQuantity < 0
            || position.SellableQuantity < 0
            || position.SellableQuantity > position.PhysicalQuantity
            || (position.PhysicalQuantity == 0 && position.Reason is not null)
            || (position.PhysicalQuantity > 0
                && position.SellableQuantity == 0
                && position.Reason is null)
            || (position.SellableQuantity > 0 && position.Reason is not null)
            || (position.PhysicalQuantity == 0
                && position.Availability != StockAvailability.OutOfStock)
            || (position.SellableQuantity > 0
                && position.Availability != StockAvailability.Available)
            || (position.PhysicalQuantity > 0
                && position.SellableQuantity == 0
                && position.Availability != StockAvailability.NotSellable))
        {
            throw new InvalidOperationException("The Stock read contract returned incompatible quantities.");
        }

        return new(
            position.Ean13.Value,
            position.Name,
            position.Type,
            position.IsActive ? ArticleLifecycleStatus.Active : ArticleLifecycleStatus.Archived,
            position.PhysicalQuantity,
            position.SellableQuantity,
            position.PhysicalQuantity - position.SellableQuantity,
            position.Availability,
            position.Reason);
    }

    private static DashboardReadResult Failure()
        => new(DashboardReadStatus.PersistenceFailed, null);
}
