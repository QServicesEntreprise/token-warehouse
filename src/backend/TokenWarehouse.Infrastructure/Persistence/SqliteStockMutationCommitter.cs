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
            var current = await context.StockPositions
                .SingleOrDefaultAsync(position => position.Ean13 == plan.Ean13.Value, cancellationToken);
            if ((current is null && plan.ExpectedPreviousPhysicalStock != 0)
                || (current is not null
                    && (current.PhysicalQuantity != plan.ExpectedPreviousPhysicalStock
                        || current.Version != plan.ExpectedPositionVersion)))
            {
                return StockMutationCommitResult.Conflict();
            }

            if (current is null)
            {
                context.StockPositions.Add(new StockPositionEntity
                {
                    Ean13 = plan.Ean13.Value,
                    PhysicalQuantity = plan.Operation.ResultingPhysicalStock,
                    Version = 1
                });
            }
            else
            {
                current.PhysicalQuantity = plan.Operation.ResultingPhysicalStock;
                current.Version++;
            }

            context.StockOperations.Add(ToEntity(plan.Operation));
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return StockMutationCommitResult.Committed(
                new StockPosition(
                    plan.Ean13,
                    plan.Operation.ResultingPhysicalStock,
                    current?.Version ?? 1));
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
            PreviousPhysicalStock = operation.PreviousPhysicalStock,
            CountedQuantity = operation.CountedQuantity,
            InventoryDifference = operation.InventoryDifference,
            ResultingPhysicalStock = operation.ResultingPhysicalStock,
            TimestampUtc = operation.TimestampUtc.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture)
        };

    private static bool IsPositionUniqueConstraintViolation(DbUpdateException exception)
        => exception.InnerException is SqliteException
        {
            SqliteErrorCode: 19,
            Message: var message
        }
        && message.Contains("StockPositions.Ean13", StringComparison.OrdinalIgnoreCase);
}
