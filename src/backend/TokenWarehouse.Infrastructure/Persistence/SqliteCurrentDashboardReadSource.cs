using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteCurrentDashboardReadSource(
    IStockReadReader stockReader,
    IClock clock) : ICurrentDashboardReadSource
{
    public async Task<IReadOnlyList<StockPositionView>> ReadAsync(
        CancellationToken cancellationToken = default)
    {
        var snapshot = await stockReader.ReadAsync(cancellationToken: cancellationToken);
        var positions = snapshot.Positions
            .GroupBy(position => position.Ean13)
            .ToDictionary(group => group.Key, group => group.First());

        return snapshot.Articles
            .OrderBy(article => article.Ean13.Value, StringComparer.Ordinal)
            .Select(article => StockPositionView.From(
                article,
                positions.GetValueOrDefault(article.Ean13),
                clock.WarehouseDate))
            .ToArray();
    }
}
