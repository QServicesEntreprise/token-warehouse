using TokenWarehouse.Application;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteCurrentDashboardReadSource(
    IStockPositionReadContract stockContract,
    IStockOperationReadContract operationContract) : ICurrentDashboardReadSource
{
    public async Task<DashboardReadSnapshot> ReadAsync(
        DashboardQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);

        var positions = await stockContract.ListAsync(
            query.Selection.ForFlowCandidates(),
            cancellationToken);
        var operations = await operationContract.ListForDashboardAsync(cancellationToken);
        if (positions.Status != StockReadStatus.Success
            || operations.Status != StockOperationReadStatus.Success)
        {
            throw new InvalidOperationException("The Dashboard read contracts could not provide a snapshot.");
        }

        return new(positions.Positions, operations.Operations);
    }
}
