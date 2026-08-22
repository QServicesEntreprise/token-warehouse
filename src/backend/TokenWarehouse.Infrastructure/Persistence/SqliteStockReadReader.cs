using Microsoft.EntityFrameworkCore;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteStockReadReader(IDbContextFactory<WarehouseDbContext> contextFactory)
    : IStockReadReader
{
    public async ValueTask<StockReadSnapshot> ReadAsync(
        Ean13? ean13 = null,
        CancellationToken cancellationToken = default,
        DashboardArticleSelection? selection = null)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        var snapshot = await ReadInSessionAsync(context, ean13, cancellationToken, selection);
        await transaction.CommitAsync(cancellationToken);
        return snapshot;
    }

    internal async Task<StockReadSnapshot> ReadInSessionAsync(
        WarehouseDbContext context,
        Ean13? ean13 = null,
        CancellationToken cancellationToken = default,
        DashboardArticleSelection? selection = null)
    {
        ArgumentNullException.ThrowIfNull(context);

        var articlesQuery = context.Articles.AsNoTracking();
        var positionsQuery = context.StockPositions.AsNoTracking();
        if (ean13 is { } value)
        {
            articlesQuery = articlesQuery.Where(article => article.Ean13 == value.Value);
            positionsQuery = positionsQuery.Where(position => position.Ean13 == value.Value);
        }
        if (selection is not null)
        {
            articlesQuery = ApplySelection(articlesQuery, selection);
        }

        var articleEntities = await articlesQuery
            .OrderBy(article => article.Ean13)
            .ToListAsync(cancellationToken);
        var articleEans = articleEntities.Select(article => article.Ean13).ToArray();
        positionsQuery = positionsQuery.Where(position => articleEans.Contains(position.Ean13));
        var positionEntities = await positionsQuery
            .OrderBy(position => position.Ean13)
            .ToListAsync(cancellationToken);

        return new(
            articleEntities
                .Select(SqliteArticleSellabilityReader.ToSnapshot)
                .ToArray(),
            positionEntities
                .Select(SqliteStockPositionReader.ToDomain)
                .OfType<StockPosition>()
                .ToArray());
    }

    private static IQueryable<ArticleEntity> ApplySelection(
        IQueryable<ArticleEntity> query,
        DashboardArticleSelection selection)
    {
        if (selection.Type is { } type)
        {
            query = query.Where(article => article.Type == ToWireType(type));
        }

        if (selection.Mode is { } mode)
        {
            var wireMode = ToWireMode(mode);
            query = query.Where(article =>
                article.Type == "food"
                && article.ConsumptionModes != null
                && article.ConsumptionModes.Contains(wireMode));
        }

        if (selection.Packaging is { } packaging)
        {
            query = query.Where(article =>
                article.Type == "nonFood"
                && article.Packaging == ToWirePackaging(packaging));
        }

        return query;
    }

    private static string ToWireMode(ConsumptionMode mode)
        => mode == ConsumptionMode.Takeaway ? "takeaway" : "onsite";

    private static string ToWireType(ArticleType type)
        => type == ArticleType.Food ? "food" : "nonFood";

    private static string ToWirePackaging(PackagingCondition packaging)
        => packaging switch
        {
            PackagingCondition.New => "new",
            PackagingCondition.Refurbished => "refurbished",
            PackagingCondition.Unsellable => "unsellable",
            _ => throw new ArgumentOutOfRangeException(nameof(packaging))
        };
}
