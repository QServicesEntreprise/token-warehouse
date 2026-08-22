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
                plan.Operation.Lines.Select(line => ToEntity(plan.Operation, line)));
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

    public async ValueTask<StockMutationCommitResult> CommitAsync(
        CounterMovementCommitPlan plan,
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            var source = await context.StockOperations
                .Include(operation => operation.Lines)
                .SingleOrDefaultAsync(operation => operation.Id == plan.SourceOperationId, cancellationToken);
            if (source is null
                || source.Type is not ("supply" or "INVENTORY" or "SALE")
                || await context.StockOperations.AnyAsync(
                    operation => operation.Type == "COUNTER_MOVEMENT"
                        && operation.SourceOperationId == plan.SourceOperationId,
                    cancellationToken))
            {
                return StockMutationCommitResult.Conflict();
            }

            var sourceType = source.Type switch
            {
                "supply" => StockOperationType.Supply,
                "INVENTORY" => StockOperationType.Inventory,
                "SALE" => StockOperationType.Sale,
                _ => (StockOperationType?)null
            };
            var sourceLines = source.Lines.OrderBy(line => line.LineNumber).ToArray();
            var counterLines = plan.Operation.Lines.OrderBy(line => line.LineNumber).ToArray();
            if (sourceType is null
                || plan.Operation.Type != StockOperationType.CounterMovement
                || plan.Operation.SourceOperationId != plan.SourceOperationId
                || plan.Operation.SourceOperationType != sourceType
                || sourceLines.Length != counterLines.Length
                || sourceLines.Zip(counterLines).Any(pair =>
                    pair.First.LineNumber != pair.Second.LineNumber
                    || pair.First.Ean13 != pair.Second.Ean13.Value
                    || pair.First.SourceEffect != pair.Second.StockEffect))
            {
                return StockMutationCommitResult.Conflict();
            }

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

                context.Entry(currentArticle).Property(article => article.Version).IsModified = true;
                currentPositions.TryGetValue(line.Ean13.Value, out var currentPosition);
                if ((currentPosition is null
                        && (line.ExpectedPreviousPhysicalStock != 0
                            || line.ExpectedPositionVersion != 0))
                    || (currentPosition is not null
                        && (currentPosition.PhysicalQuantity != line.ExpectedPreviousPhysicalStock
                            || currentPosition.Version != line.ExpectedPositionVersion)))
                {
                    return StockMutationCommitResult.Conflict();
                }

                var resultingPhysicalStock = (long)line.ExpectedPreviousPhysicalStock
                    + line.OperationLine.InverseEffect;
                if (resultingPhysicalStock is < 0 or > int.MaxValue)
                {
                    return StockMutationCommitResult.Conflict();
                }
            }

            var committedPositions = new List<StockPosition>(plan.Lines.Count);
            foreach (var line in plan.Lines)
            {
                currentPositions.TryGetValue(line.Ean13.Value, out var currentPosition);
                var resultingPhysicalStock = checked(
                    (int)((long)line.ExpectedPreviousPhysicalStock + line.OperationLine.InverseEffect));
                if (currentPosition is null)
                {
                    context.StockPositions.Add(new StockPositionEntity
                    {
                        Ean13 = line.Ean13.Value,
                        PhysicalQuantity = resultingPhysicalStock,
                        Version = 1
                    });
                    committedPositions.Add(new StockPosition(
                        line.Ean13,
                        resultingPhysicalStock,
                        1));
                }
                else
                {
                    currentPosition.PhysicalQuantity = resultingPhysicalStock;
                    currentPosition.Version++;
                    committedPositions.Add(new StockPosition(
                        line.Ean13,
                        currentPosition.PhysicalQuantity,
                        currentPosition.Version));
                }
            }

            context.StockOperations.Add(ToEntity(plan.Operation));
            context.StockOperationLines.AddRange(
                plan.Operation.Lines.Select(line => ToEntity(plan.Operation, line)));
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return StockMutationCommitResult.Committed(committedPositions);
        }
        catch (DbUpdateConcurrencyException)
        {
            return StockMutationCommitResult.Conflict();
        }
        catch (DbUpdateException exception) when (IsConflict(exception))
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
            Type = operation.Type switch
            {
                StockOperationType.CounterMovement => "COUNTER_MOVEMENT",
                StockOperationType.Sale => "SALE",
                StockOperationType.Supply => "supply",
                _ => "INVENTORY"
            },
            Ean13 = operation.Ean13.Value,
            Quantity = operation.Type == StockOperationType.Supply ? operation.Quantity.Value : 0,
            OccurredAt = operation.TimestampUtc.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
            PreviousPhysicalStock = operation.PreviousPhysicalStock,
            CountedQuantity = operation.CountedQuantity,
            InventoryDifference = operation.InventoryDifference,
            ResultingPhysicalStock = operation.ResultingPhysicalStock,
            TimestampUtc = operation.TimestampUtc.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
            SourceOperationId = operation.SourceOperationId,
            SourceOperationType = operation.SourceOperationType?.ToString().ToUpperInvariant(),
            Justification = operation.Justification
        };

    private static StockOperationLineEntity ToEntity(
        StockOperation operation,
        StockOperationLine line)
        => new()
        {
            OperationId = operation.Id,
            LineNumber = line.LineNumber,
            Ean13 = line.Ean13.Value,
            OperationType = operation.Type == StockOperationType.CounterMovement
                ? "COUNTER_MOVEMENT"
                : operation.Type == StockOperationType.Sale
                    ? "SALE"
                    : operation.Type == StockOperationType.Supply
                        ? "supply"
                        : "INVENTORY",
            PreviousPhysicalStock = line.PreviousPhysicalStock,
            CountedQuantity = line.CountedQuantity,
            InventoryDifference = line.InventoryDifference,
            ResultingPhysicalStock = line.ResultingPhysicalStock,
            Quantity = operation.Type is StockOperationType.Supply or StockOperationType.Sale
                ? line.Quantity.Value
                : 0,
            SourceEffect = line.StockEffect,
            InverseEffect = line.InverseEffect
        };

    private static bool IsPositionUniqueConstraintViolation(DbUpdateException exception)
        => exception.InnerException is SqliteException
        {
            SqliteErrorCode: 19,
            Message: var message
        }
        && message.Contains("StockPositions.Ean13", StringComparison.OrdinalIgnoreCase);

    private static bool IsConflict(DbUpdateException exception)
        => exception.InnerException is SqliteException
        {
            SqliteErrorCode: 19,
            Message: var message
        }
        && (message.Contains("StockPositions", StringComparison.OrdinalIgnoreCase)
            || message.Contains("SourceOperationId", StringComparison.OrdinalIgnoreCase)
            || message.Contains("StockOperationLines", StringComparison.OrdinalIgnoreCase));
}
