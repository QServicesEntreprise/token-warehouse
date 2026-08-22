using TokenWarehouse.Domain;

namespace TokenWarehouse.Application;

public sealed record WarehouseDateRange(DateOnly From, DateOnly To);

public sealed record DashboardArticleSelection(
    ArticleType? Type,
    ConsumptionMode? Mode,
    PackagingCondition? Packaging)
{
    public bool Matches(StockPositionView position)
        => (Type is null || position.Type == Type)
            && (Mode is null
                || (position.Type == ArticleType.Food && position.ConsumptionModes.Contains(Mode.Value)))
            && (Packaging is null
                || (position.Type == ArticleType.NonFood && position.Packaging == Packaging.Value));
}

public sealed record DashboardQuery(
    WarehouseDateRange Period,
    DashboardArticleSelection Selection);

public interface IWarehouseCalendar
{
    DateOnly WarehouseDate { get; }

    WarehouseDateRange CurrentMonth { get; }
}

public sealed class WarehouseCalendar(IClock clock) : IWarehouseCalendar
{
    public DateOnly WarehouseDate => clock.WarehouseDate;

    public WarehouseDateRange CurrentMonth
    {
        get
        {
            var first = new DateOnly(WarehouseDate.Year, WarehouseDate.Month, 1);
            return new(first, first.AddMonths(1).AddDays(-1));
        }
    }
}

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
    Task<DashboardReadResult> ReadAsync(
        DashboardQuery query,
        CancellationToken cancellationToken = default);
}

public interface ICurrentDashboardReadSource
{
    Task<IReadOnlyList<StockPositionView>> ReadAsync(
        DashboardQuery query,
        CancellationToken cancellationToken = default);
}

public sealed class DashboardApplication(ICurrentDashboardReadSource readSource)
    : IReadCurrentDashboardUseCase
{
    public async Task<DashboardReadResult> ReadAsync(
        DashboardQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);

        try
        {
            var rows = (await readSource.ReadAsync(query, cancellationToken))
                .Where(query.Selection.Matches)
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
