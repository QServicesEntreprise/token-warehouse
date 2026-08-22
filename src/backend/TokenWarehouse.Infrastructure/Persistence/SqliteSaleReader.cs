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
        var financial = SqliteSaleFinancialSnapshotReader.Read(operationEntity, out var position);
        if (position is null)
        {
            throw new InvalidOperationException("Stored Sale snapshot is invalid.");
        }

        return new(
            operation,
            financial,
            position);
    }
}
