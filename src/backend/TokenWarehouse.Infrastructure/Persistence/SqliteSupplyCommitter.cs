using System.Globalization;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteSupplyCommitter(
    IDbContextFactory<WarehouseDbContext> contextFactory) : ISupplyCommitter
{
    public async ValueTask<SupplyCommitResult> CommitAsync(
        SupplyCommitRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);

        try
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var article = await context.Articles.SingleOrDefaultAsync(
                candidate => candidate.Ean13 == request.Article.Ean13.Value
                    && candidate.IsActive
                    && candidate.Version == request.Article.Version,
                cancellationToken);
            if (article is null)
            {
                return Conflict();
            }

            var currentPosition = await context.StockPositions
                .AsNoTracking()
                .SingleOrDefaultAsync(
                    position => position.Ean13 == request.Position.Ean13.Value,
                    cancellationToken);
            if (request.CurrentPosition is null)
            {
                if (currentPosition is not null)
                {
                    return Conflict();
                }

                context.StockPositions.Add(new StockPositionEntity
                {
                    Ean13 = request.Position.Ean13.Value,
                    PhysicalQuantity = request.Position.PhysicalQuantity
                });
            }
            else
            {
                if (currentPosition is null || currentPosition.PhysicalQuantity != request.CurrentPosition.PhysicalQuantity)
                {
                    return Conflict();
                }

                var affectedRows = await context.Database.ExecuteSqlInterpolatedAsync(
                    $"UPDATE StockPositions SET PhysicalQuantity = {request.Position.PhysicalQuantity} WHERE Ean13 = {request.Position.Ean13.Value} AND PhysicalQuantity = {request.CurrentPosition.PhysicalQuantity}",
                    cancellationToken);
                if (affectedRows != 1)
                {
                    return Conflict();
                }
            }

            context.StockOperations.Add(ToEntity(request.Operation));
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new(
                SupplyCommitStatus.Committed,
                request.Position,
                request.Operation);
        }
        catch (DbUpdateException exception) when (IsConflict(exception))
        {
            return Conflict();
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode is 5 or 6)
        {
            return Conflict();
        }
    }

    private static StockOperationEntity ToEntity(StockOperation operation)
        => new()
        {
            Id = operation.Id,
            Type = "supply",
            Ean13 = operation.Ean13.Value,
            Quantity = operation.Quantity.Value,
            OccurredAt = operation.OccurredAt.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture)
        };

    private static SupplyCommitResult Conflict()
        => new(SupplyCommitStatus.Conflict, null, null);

    private static bool IsConflict(DbUpdateException exception)
        => exception.InnerException is SqliteException { SqliteErrorCode: 5 or 6 or 19 };
}
