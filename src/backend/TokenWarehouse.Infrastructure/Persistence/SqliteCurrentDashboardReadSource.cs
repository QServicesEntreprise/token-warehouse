using TokenWarehouse.Application;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteCurrentDashboardReadSource(
    IStockPositionReadContract stockContract) : ICurrentDashboardReadSource
{
    public async Task<IReadOnlyList<StockPositionView>> ReadAsync(
        CancellationToken cancellationToken = default)
    {
        var result = await stockContract.ListAsync(cancellationToken);
        if (result.Status != StockReadStatus.Success)
        {
            throw new InvalidOperationException("The Stock read contract could not provide a Dashboard snapshot.");
        }

        return result.Positions;
    }
}
