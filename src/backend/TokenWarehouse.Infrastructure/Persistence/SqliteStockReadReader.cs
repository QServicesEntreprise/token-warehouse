using Microsoft.EntityFrameworkCore;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteStockReadReader(IDbContextFactory<WarehouseDbContext> contextFactory)
    : IStockReadReader
{
    public async ValueTask<StockReadSnapshot> ReadAsync(
        Ean13? ean13 = null,
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        var articlesQuery = context.Articles.AsNoTracking();
        var positionsQuery = context.StockPositions.AsNoTracking();
        if (ean13 is { } value)
        {
            articlesQuery = articlesQuery.Where(article => article.Ean13 == value.Value);
            positionsQuery = positionsQuery.Where(position => position.Ean13 == value.Value);
        }

        var articleEntities = await articlesQuery
            .OrderBy(article => article.Ean13)
            .ToListAsync(cancellationToken);
        var positionEntities = await positionsQuery
            .OrderBy(position => position.Ean13)
            .ToListAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);

        return new(
            articleEntities
                .Select(entity => ArticleSellabilitySnapshot.From(SqliteArticleStore.ToDomain(entity)))
                .ToArray(),
            positionEntities
                .Select(SqliteStockPositionReader.ToDomain)
                .OfType<StockPosition>()
                .ToArray());
    }
}
