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
        var line = request.Operation.Lines.Count == 1
            ? request.Operation.Lines[0]
            : new StockOperationLine(1, request.Operation.Ean13, request.Operation.Quantity);
        var result = await CommitAsync(
            new BulkSupplyCommitRequest(
                request.Operation,
                [new(
                    request.ArticleSnapshot,
                    request.CurrentPosition,
                    request.Position,
                    line)]),
            cancellationToken);

        return result.Status switch
        {
            BulkSupplyCommitStatus.Committed when result.Operation is not null
                && result.Positions is { Count: > 0 }
                => new(
                    SupplyCommitStatus.Committed,
                    result.Positions[0],
                    result.Operation),
            BulkSupplyCommitStatus.Conflict => new(SupplyCommitStatus.Conflict, null, null),
            _ => throw new InvalidOperationException("The supply commit failed.")
        };
    }

    public async ValueTask<BulkSupplyCommitResult> CommitAsync(
        BulkSupplyCommitRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.Lines.Count == 0 || request.Operation.Lines.Count != request.Lines.Count)
        {
            return BulkSupplyCommitResult.Failed();
        }

        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            var eanValues = request.Lines
                .Select(line => line.OperationLine.Ean13.Value)
                .Distinct(StringComparer.Ordinal)
                .ToArray();
            var articles = await context.Articles
                .AsNoTracking()
                .Where(article => eanValues.Contains(article.Ean13))
                .ToDictionaryAsync(article => article.Ean13, StringComparer.Ordinal, cancellationToken);
            foreach (var line in request.Lines)
            {
                var ean13 = line.OperationLine.Ean13.Value;
                if (!articles.TryGetValue(ean13, out var article)
                    || !article.IsActive
                    || article.Version != line.ArticleSnapshot.Version)
                {
                    return BulkSupplyCommitResult.Conflict();
                }
            }

            var currentPositions = await context.StockPositions
                .AsNoTracking()
                .Where(position => eanValues.Contains(position.Ean13))
                .ToDictionaryAsync(position => position.Ean13, StringComparer.Ordinal, cancellationToken);
            foreach (var line in request.Lines)
            {
                var ean13 = line.OperationLine.Ean13.Value;
                currentPositions.TryGetValue(ean13, out var currentPosition);
                if (line.CurrentPosition is null)
                {
                    if (currentPosition is not null)
                    {
                        return BulkSupplyCommitResult.Conflict();
                    }

                    context.StockPositions.Add(new StockPositionEntity
                    {
                        Ean13 = ean13,
                        PhysicalQuantity = line.Position.PhysicalQuantity,
                        Version = 1
                    });
                }
                else if (currentPosition is null
                    || currentPosition.PhysicalQuantity != line.CurrentPosition.PhysicalQuantity
                    || currentPosition.Version != line.CurrentPosition.Version)
                {
                    return BulkSupplyCommitResult.Conflict();
                }
            }

            foreach (var line in request.Lines
                .Where(line => line.CurrentPosition is not null)
                .OrderBy(line => line.OperationLine.Ean13.Value, StringComparer.Ordinal))
            {
                var expected = line.CurrentPosition!;
                var affectedRows = await context.Database.ExecuteSqlInterpolatedAsync(
                    $"UPDATE StockPositions SET PhysicalQuantity = {line.Position.PhysicalQuantity}, Version = {expected.Version + 1} WHERE Ean13 = {expected.Ean13.Value} AND PhysicalQuantity = {expected.PhysicalQuantity} AND Version = {expected.Version}",
                    cancellationToken);
                if (affectedRows != 1)
                {
                    return BulkSupplyCommitResult.Conflict();
                }
            }

            var committedLineByNumber = request.Lines.ToDictionary(line => line.OperationLine.LineNumber);
            context.StockOperations.Add(ToEntity(request.Operation, request.Lines));
            context.StockOperationLines.AddRange(request.Operation.Lines.Select(line => new StockOperationLineEntity
            {
                OperationId = request.Operation.Id,
                LineNumber = line.LineNumber,
                Ean13 = line.Ean13.Value,
                OperationType = "supply",
                Quantity = line.Quantity.Value,
                PreviousPhysicalStock = committedLineByNumber[line.LineNumber].CurrentPosition?.PhysicalQuantity ?? 0,
                ResultingPhysicalStock = committedLineByNumber[line.LineNumber].Position.PhysicalQuantity,
                SourceEffect = line.StockEffect,
                InverseEffect = line.InverseEffect
            }));
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            var committedPositions = request.Lines
                .Select(line => new StockPosition(
                    line.Position.Ean13,
                    line.Position.PhysicalQuantity,
                    line.CurrentPosition?.Version + 1 ?? 1))
                .ToArray();
            return BulkSupplyCommitResult.Committed(request.Operation, committedPositions);
        }
        catch (DbUpdateException exception) when (IsConflict(exception))
        {
            return BulkSupplyCommitResult.Conflict();
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode is 5 or 6)
        {
            return BulkSupplyCommitResult.Conflict();
        }
        catch (Exception) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            return BulkSupplyCommitResult.Failed();
        }
    }

    private static StockOperationEntity ToEntity(
        StockOperation operation,
        IReadOnlyList<BulkSupplyCommitLine> lines)
    {
        var singleLine = lines.Count == 1 ? lines[0] : null;
        return new()
        {
            Id = operation.Id,
            Type = "supply",
            Ean13 = operation.Ean13.Value,
            Quantity = operation.Quantity.Value,
            OccurredAt = operation.OccurredAt.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
            PreviousPhysicalStock = singleLine?.CurrentPosition?.PhysicalQuantity ?? 0,
            CountedQuantity = 0,
            InventoryDifference = 0,
            ResultingPhysicalStock = singleLine?.Position.PhysicalQuantity ?? 0,
            TimestampUtc = operation.OccurredAt.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture)
        };
    }

    private static bool IsConflict(DbUpdateException exception)
        => exception.InnerException is SqliteException
        {
            SqliteErrorCode: 5 or 6
        }
        || exception.InnerException is SqliteException
        {
            SqliteErrorCode: 19,
            Message: var message
        }
        && (message.Contains("UNIQUE", StringComparison.OrdinalIgnoreCase)
            || message.Contains("StockPositions", StringComparison.OrdinalIgnoreCase));
}
