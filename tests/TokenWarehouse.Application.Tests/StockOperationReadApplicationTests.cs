using TokenWarehouse.Application;
using TokenWarehouse.Domain;
using Xunit;

namespace TokenWarehouse.Application.Tests;

public sealed class StockOperationReadApplicationTests
{
    [Fact]
    public async Task Lists_operation_facts_in_deterministic_order_without_rebuilding_stock()
    {
        var firstEan13 = ParseEan("0123456789012");
        var secondEan13 = ParseEan("5901234123457");
        var timestamp = new DateTimeOffset(2030, 1, 15, 10, 0, 0, TimeSpan.Zero);
        var later = StockOperation.CreateSupply("b-operation", firstEan13, new Quantity(2), timestamp.AddMinutes(1));
        var earlier = StockOperation.CreateInventory(
            "a-operation",
            secondEan13,
            InventoryReconciliation.Reconcile(4, 6),
            timestamp);
        var application = new StockOperationReadApplication(
            new FakeOperationReader([later, earlier]));

        var result = await application.ListAsync();

        Assert.Equal(StockOperationReadStatus.Success, result.Status);
        Assert.Equal(["a-operation", "b-operation"], result.Operations.Select(operation => operation.Id));
        Assert.Equal("5901234123457", result.Operations[0].Ean13);
        Assert.Single(result.Operations[0].Lines);
        Assert.Equal(2, result.Operations[0].Lines[0].StockEffect);
        Assert.Equal(6, result.Operations[0].Lines[0].ResultingPhysicalStock);
    }

    private static Ean13 ParseEan(string value)
    {
        Assert.True(Ean13.TryCreate(value, out var ean13));
        return ean13;
    }

    private sealed class FakeOperationReader(IReadOnlyList<StockOperation> operations) : IStockOperationReader
    {
        public ValueTask<IReadOnlyList<StockOperation>> ListAsync(
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult(operations);

        public ValueTask<StockOperation?> FindByIdAsync(
            string id,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult<StockOperation?>(operations.SingleOrDefault(operation => operation.Id == id));
    }
}
