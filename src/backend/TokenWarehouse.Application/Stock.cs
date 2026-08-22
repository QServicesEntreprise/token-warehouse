using TokenWarehouse.Domain;

namespace TokenWarehouse.Application;

public sealed record StockPositionView(
    Ean13 Ean13,
    string Name,
    ArticleType Type,
    bool IsActive,
    DateOnly? Dlc,
    IReadOnlyList<ConsumptionMode> ConsumptionModes,
    PackagingCondition? Packaging,
    int PhysicalQuantity,
    int SellableQuantity,
    StockAvailability Availability,
    SellabilityReason? Reason)
{
    public static IReadOnlyList<StockPositionView> From(
        StockReadSnapshot snapshot,
        DateOnly warehouseDate)
    {
        ArgumentNullException.ThrowIfNull(snapshot);

        var positions = snapshot.Positions
            .GroupBy(position => position.Ean13)
            .ToDictionary(group => group.Key, group => group.First());
        return snapshot.Articles
            .OrderBy(article => article.Ean13.Value, StringComparer.Ordinal)
            .Select(article => From(article, positions.GetValueOrDefault(article.Ean13), warehouseDate))
            .ToArray();
    }

    public static StockPositionView From(
        ArticleSellabilitySnapshot article,
        StockPosition? position,
        DateOnly warehouseDate)
    {
        ArgumentNullException.ThrowIfNull(article);

        var physicalQuantity = position?.PhysicalQuantity ?? 0;
        var decision = SellabilityPolicy.Decide(article, physicalQuantity, warehouseDate);
        return new(
            article.Ean13,
            article.Name,
            article.Type,
            article.IsActive,
            article.Dlc,
            article.ConsumptionModes,
            article.Packaging,
            physicalQuantity,
            decision.SellableQuantity,
            decision.Availability,
            decision.Reason);
    }
}

public enum StockReadStatus
{
    Success,
    ValidationFailed,
    NotFound
}

public sealed record StockReadSnapshot(
    IReadOnlyList<ArticleSellabilitySnapshot> Articles,
    IReadOnlyList<StockPosition> Positions);

public interface IStockReadReader
{
    ValueTask<StockReadSnapshot> ReadAsync(
        Ean13? ean13 = null,
        CancellationToken cancellationToken = default,
        DashboardArticleSelection? selection = null);
}

public sealed record StockReadResult(
    StockReadStatus Status,
    IReadOnlyList<StockPositionView> Positions,
    StockPositionView? Position,
    IReadOnlyList<ArticleValidationError> Errors);

public interface IStockPositionReadContract
{
    Task<StockReadResult> ListAsync(
        DashboardArticleSelection? selection = null,
        CancellationToken cancellationToken = default);

    Task<StockReadResult> GetAsync(string ean13, CancellationToken cancellationToken = default);
}

public interface IReadStockUseCase : IStockPositionReadContract
{
}

public sealed class StockApplication(
    IStockReadReader stockReader,
    IClock clock) : IReadStockUseCase
{
    public async Task<StockReadResult> ListAsync(
        DashboardArticleSelection? selection = null,
        CancellationToken cancellationToken = default)
    {
        var snapshot = await stockReader.ReadAsync(
            cancellationToken: cancellationToken,
            selection: selection);
        var positions = StockPositionView.From(snapshot, clock.WarehouseDate);

        return new(
            StockReadStatus.Success,
            positions,
            null,
            []);
    }

    public async Task<StockReadResult> GetAsync(
        string ean13,
        CancellationToken cancellationToken = default)
    {
        if (!Ean13.TryCreate(ean13, out var parsedEan13))
        {
            return new(
                StockReadStatus.ValidationFailed,
                [],
                null,
                [new(
                    "stock.ean13.invalid",
                    "ean13",
                    "L’EAN-13 doit contenir 13 chiffres et un checksum valide.")]);
        }

        var snapshot = await stockReader.ReadAsync(parsedEan13, cancellationToken);
        var article = snapshot.Articles.SingleOrDefault(candidate => candidate.Ean13 == parsedEan13);
        return article is null
            ? new(StockReadStatus.NotFound, [], null, [])
            : new(
                StockReadStatus.Success,
                [],
                ToView(
                    article,
                    snapshot.Positions.SingleOrDefault(position => position.Ean13 == parsedEan13)),
                []);
    }

    private StockPositionView ToView(ArticleSellabilitySnapshot article, StockPosition? position)
        => StockPositionView.From(article, position, clock.WarehouseDate);
}
