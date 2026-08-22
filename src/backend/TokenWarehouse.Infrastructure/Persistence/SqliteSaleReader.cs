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
                out var payloadFinancial,
                out var position)
            || position is null)
        {
            throw new InvalidOperationException("Stored Sale snapshot is invalid.");
        }

        var financial = HasExplicitFinancialSnapshot(operationEntity)
            ? ReadExplicitFinancialSnapshot(operationEntity, payloadFinancial)
            : payloadFinancial;

        return new(
            operation,
            financial,
            position);
    }

    private static bool HasExplicitFinancialSnapshot(StockOperationEntity operation)
        => operation.SaleFinancialUnitPriceHtCents is not null
            || operation.SaleFinancialTaxRateCode is not null
            || operation.SaleFinancialTaxRateNumerator is not null
            || operation.SaleFinancialTaxRateDenominator is not null
            || operation.SaleFinancialAmountHtCents is not null
            || operation.SaleFinancialVatCents is not null
            || operation.SaleFinancialAmountTtcCents is not null;

    private static SaleFinancialSnapshot ReadExplicitFinancialSnapshot(
        StockOperationEntity operation,
        SaleFinancialSnapshot payloadFinancial)
    {
        if (operation.SaleFinancialUnitPriceHtCents is not { } unitPriceHtCents
            || operation.SaleFinancialTaxRateCode is not { } taxRateCode
            || operation.SaleFinancialTaxRateNumerator is not { } taxRateNumerator
            || operation.SaleFinancialTaxRateDenominator is not { } taxRateDenominator
            || operation.SaleFinancialAmountHtCents is not { } amountHtCents
            || operation.SaleFinancialVatCents is not { } vatCents
            || operation.SaleFinancialAmountTtcCents is not { } amountTtcCents)
        {
            throw new InvalidOperationException("Stored Sale financial snapshot is incomplete.");
        }

        var financial = new SaleFinancialSnapshot(
            operation.SaleFinancialContext switch
            {
                null => null,
                "takeaway" => SaleContext.Takeaway,
                "onsite" => SaleContext.OnSite,
                _ => throw new InvalidOperationException("Stored Sale financial context is invalid.")
            },
            Money.FromCents(unitPriceHtCents),
            new TaxRate(taxRateCode, taxRateNumerator, taxRateDenominator),
            Money.FromCents(amountHtCents),
            Money.FromCents(vatCents),
            Money.FromCents(amountTtcCents));
        if (financial != payloadFinancial)
        {
            throw new InvalidOperationException("Stored Sale financial snapshot is inconsistent.");
        }

        return financial;
    }
}
