using System.Globalization;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteStockMutationCommitter(
    IDbContextFactory<WarehouseDbContext> contextFactory) : IStockMutationCommitter
{
    public async ValueTask<StockMutationCommitResult> CommitAsync(
        InventoryCommitPlan plan,
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            var eans = plan.Lines.Select(line => line.Ean13.Value).ToArray();
            var currentArticles = await context.Articles
                .Where(article => eans.Contains(article.Ean13))
                .ToDictionaryAsync(article => article.Ean13, StringComparer.Ordinal, cancellationToken);
            var currentPositions = await context.StockPositions
                .Where(position => eans.Contains(position.Ean13))
                .ToDictionaryAsync(position => position.Ean13, StringComparer.Ordinal, cancellationToken);

            foreach (var line in plan.Lines)
            {
                if (!currentArticles.TryGetValue(line.Ean13.Value, out var currentArticle)
                    || currentArticle.Version != line.ExpectedArticleVersion)
                {
                    return StockMutationCommitResult.Conflict();
                }

                // Keep the Article in this SaveChanges call so its concurrency tokens are checked atomically.
                context.Entry(currentArticle).Property(article => article.Version).IsModified = true;
                currentPositions.TryGetValue(line.Ean13.Value, out var current);
                if ((current is null
                        && (line.ExpectedPreviousPhysicalStock != 0
                            || line.ExpectedPositionVersion != 0))
                    || (current is not null
                        && (current.PhysicalQuantity != line.ExpectedPreviousPhysicalStock
                            || current.Version != line.ExpectedPositionVersion)))
                {
                    return StockMutationCommitResult.Conflict();
                }
            }

            var committedPositions = new List<StockPosition>(plan.Lines.Count);
            foreach (var line in plan.Lines)
            {
                currentPositions.TryGetValue(line.Ean13.Value, out var current);
                if (current is null)
                {
                    context.StockPositions.Add(new StockPositionEntity
                    {
                        Ean13 = line.Ean13.Value,
                        PhysicalQuantity = line.OperationLine.ResultingPhysicalStock,
                        Version = 1
                    });
                    committedPositions.Add(new StockPosition(
                        line.Ean13,
                        line.OperationLine.ResultingPhysicalStock,
                        1));
                }
                else
                {
                    current.PhysicalQuantity = line.OperationLine.ResultingPhysicalStock;
                    current.Version++;
                    committedPositions.Add(new StockPosition(
                        line.Ean13,
                        line.OperationLine.ResultingPhysicalStock,
                        current.Version));
                }
            }

            context.StockOperations.Add(ToEntity(plan.Operation));
            context.StockOperationLines.AddRange(
                plan.Operation.Lines.Select(line => ToEntity(plan.Operation.Id, line)));
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return StockMutationCommitResult.Committed(committedPositions);
        }
        catch (DbUpdateConcurrencyException)
        {
            return StockMutationCommitResult.Conflict();
        }
        catch (DbUpdateException exception) when (IsPositionUniqueConstraintViolation(exception))
        {
            return StockMutationCommitResult.Conflict();
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode is 5 or 6)
        {
            return StockMutationCommitResult.Conflict();
        }
        catch (Exception) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            return StockMutationCommitResult.Failed();
        }
    }

    private static StockOperationEntity ToEntity(StockOperation operation)
        => new()
        {
            Id = operation.Id,
            Type = "INVENTORY",
            Ean13 = operation.Ean13.Value,
            Quantity = 0,
            OccurredAt = operation.TimestampUtc.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
            PreviousPhysicalStock = operation.PreviousPhysicalStock,
            CountedQuantity = operation.CountedQuantity,
            InventoryDifference = operation.InventoryDifference,
            ResultingPhysicalStock = operation.ResultingPhysicalStock,
            TimestampUtc = operation.TimestampUtc.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture)
        };

    private static StockOperationLineEntity ToEntity(
        string operationId,
        StockOperationLine line)
        => new()
        {
            OperationId = operationId,
            LineNumber = line.LineNumber,
            Ean13 = line.Ean13.Value,
            PreviousPhysicalStock = line.PreviousPhysicalStock,
            CountedQuantity = line.CountedQuantity,
            InventoryDifference = line.InventoryDifference,
            ResultingPhysicalStock = line.ResultingPhysicalStock
        };

    private static bool IsPositionUniqueConstraintViolation(DbUpdateException exception)
        => exception.InnerException is SqliteException
        {
            SqliteErrorCode: 19,
            Message: var message
        }
        && message.Contains("StockPositions.Ean13", StringComparison.OrdinalIgnoreCase);
}
