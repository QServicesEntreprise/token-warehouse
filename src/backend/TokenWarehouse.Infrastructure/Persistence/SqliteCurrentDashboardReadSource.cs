using Microsoft.EntityFrameworkCore;
using TokenWarehouse.Application;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteCurrentDashboardReadSource(
    IDbContextFactory<WarehouseDbContext> contextFactory,
    SqliteStockReadReader stockReader,
    SqliteStockOperationReader operationReader,
    IClock clock) : ICurrentDashboardReadSource
{
    public async Task<DashboardReadSnapshot> ReadAsync(
        DashboardQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);

        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
        var stockSnapshot = await stockReader.ReadInSessionAsync(
            context,
            cancellationToken: cancellationToken,
            selection: query.Selection.ForFlowCandidates());
        var operationFacts = await operationReader.ListForDashboardInSessionAsync(
            context,
            cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var positions = StockPositionView.From(stockSnapshot, clock.WarehouseDate);
        var operations = operationFacts
            .OrderBy(fact => fact.Operation.TimestampUtc)
            .ThenBy(fact => fact.Operation.Id, StringComparer.Ordinal)
            .Select(StockOperationReadView.From)
            .ToArray();

        return new(positions, operations);
    }
}
