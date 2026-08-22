using TokenWarehouse.Application;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteCurrentDashboardReadSource(
    IStockPositionReadContract stockContract) : ICurrentDashboardReadSource
{
    public async Task<IReadOnlyList<StockPositionView>> ReadAsync(
        DashboardQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);

        var result = await stockContract.ListAsync(cancellationToken);
        if (result.Status != StockReadStatus.Success)
        {
            throw new InvalidOperationException("The Stock read contract could not provide a Dashboard snapshot.");
        }

        return result.Positions
            .Where(query.Selection.Matches)
            .ToArray();
    }
}
