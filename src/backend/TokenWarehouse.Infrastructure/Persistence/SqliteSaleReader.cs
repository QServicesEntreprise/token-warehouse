using Microsoft.EntityFrameworkCore;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteSaleReader(
    IDbContextFactory<WarehouseDbContext> contextFactory,
    IStockOperationReader operationReader) : ISaleReader
{
    public async ValueTask<SaleReadRecord?> FindByOperationIdAsync(
        string operationId,
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        var operationEntity = await context.StockOperations
            .AsNoTracking()
            .SingleOrDefaultAsync(
                operation => operation.Id == operationId && operation.Type == "SALE",
                cancellationToken);
        if (operationEntity is null)
        {
            return null;
        }

        var operation = await operationReader.FindByIdAsync(operationId, cancellationToken)
            ?? throw new InvalidOperationException("Stored Sale operation is missing.");
        if (!SaleFinancialSnapshotSerializer.TryDeserialize(
                operationEntity.SaleCommitDataType,
                operationEntity.SaleCommitDataPayload,
                out var financial))
        {
            throw new InvalidOperationException("Stored Sale financial data is invalid.");
        }

        var articleEntity = await context.Articles
            .AsNoTracking()
            .SingleOrDefaultAsync(article => article.Ean13 == operation.Ean13.Value, cancellationToken)
            ?? throw new InvalidOperationException("Stored Sale Article is missing.");
        var positionEntity = await context.StockPositions
            .AsNoTracking()
            .SingleOrDefaultAsync(position => position.Ean13 == operation.Ean13.Value, cancellationToken);
        var position = positionEntity is null
            ? null
            : SqliteStockPositionReader.ToDomain(positionEntity);
        if (positionEntity is not null && position is null)
        {
            throw new InvalidOperationException("Stored Sale position is invalid.");
        }

        return new(
            operation,
            financial,
            SqliteArticleSellabilityReader.ToSnapshot(articleEntity),
            position);
    }
}
