using TokenWarehouse.Domain;
using Xunit;

namespace TokenWarehouse.Application.Tests;

public sealed class SaleApplicationTests
{
    private static readonly DateTimeOffset Now =
        new(2030, 1, 15, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Records_a_non_food_sale_with_a_financial_snapshot_in_the_stock_transaction()
    {
        var ean13 = ParseEan("0123456789012");
        var stock = new RecordingStockSaleContract(ean13, 5);
        var application = new SaleApplication(
            new FakeArticleSaleReader(new ArticleSaleSnapshot(
                ean13,
                "Batterie industrielle",
                ArticleType.NonFood,
                true,
                null,
                [],
                PackagingCondition.New,
                Money.FromCents(101))),
            stock,
            new EmptySaleReader(),
            new FixedClock());

        var result = await application.RecordAsync(new SaleCommand
        {
            Ean13 = ean13.Value,
            Quantity = 3
        });

        Assert.Equal(SaleStatus.Committed, result.Status);
        Assert.NotNull(result.Receipt);
        Assert.Equal(101, result.Receipt!.Financial.UnitPriceHt.Cents);
        Assert.Equal(303, result.Receipt.Financial.AmountHt.Cents);
        Assert.Equal(61, result.Receipt.Financial.Vat.Cents);
        Assert.Equal(364, result.Receipt.Financial.AmountTtc.Cents);
        Assert.Equal("sale.financial.v1", stock.ParticipantData?.Type);
        Assert.Contains("\"amountHtCents\":303", stock.ParticipantData?.Payload);
        Assert.Equal(5, result.Receipt.Position.PhysicalQuantity);
    }

    [Fact]
    public async Task Rejects_food_articles_before_the_stock_contract_without_inventing_a_context()
    {
        var ean13 = ParseEan("0123456789012");
        var stock = new RecordingStockSaleContract(ean13, 5);
        var application = new SaleApplication(
            new FakeArticleSaleReader(new ArticleSaleSnapshot(
                ean13,
                "Café torréfié",
                ArticleType.Food,
                true,
                new DateOnly(2030, 1, 15),
                [ConsumptionMode.Takeaway],
                null,
                Money.FromCents(101))),
            stock,
            new EmptySaleReader(),
            new FixedClock());

        var result = await application.RecordAsync(new SaleCommand
        {
            Ean13 = ean13.Value,
            Quantity = 1
        });

        Assert.Equal(SaleStatus.ContextUnsupported, result.Status);
        Assert.Equal("CONTEXT_UNSUPPORTED", Assert.Single(result.Errors).Code);
        Assert.Equal(0, stock.Calls);
    }

    private static Ean13 ParseEan(string value)
    {
        Assert.True(Ean13.TryCreate(value, out var ean13));
        return ean13;
    }

    private sealed class FixedClock : IClock
    {
        public DateTimeOffset UtcNow => Now;

        public DateOnly WarehouseDate => new(2030, 1, 15);
    }

    private sealed class FakeArticleSaleReader(ArticleSaleSnapshot article) : IArticleSaleReader
    {
        public ValueTask<ArticleSaleSnapshot?> FindByEanAsync(
            Ean13 ean13,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult<ArticleSaleSnapshot?>(article.Ean13 == ean13 ? article : null);

        public ValueTask<IReadOnlyList<ArticleSaleSnapshot>> SearchAsync(
            string? search,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult<IReadOnlyList<ArticleSaleSnapshot>>([article]);
    }

    private sealed class EmptySaleReader : ISaleReader
    {
        public ValueTask<SaleReadRecord?> FindByOperationIdAsync(
            string operationId,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult<SaleReadRecord?>(null);
    }

    private sealed class RecordingStockSaleContract(Ean13 ean13, int resultingPhysical)
        : IStockSaleContract
    {
        public int Calls { get; private set; }

        public StockSaleCommitData? ParticipantData { get; private set; }

        public Task<StockSaleCheckResult> CheckSellabilityAsync(
            StockSaleCommand command,
            CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public Task<StockSaleResult> RecordAsync(
            StockSaleCommand command,
            CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public async Task<StockSaleResult> RecordAsync(
            StockSaleCommand command,
            IStockSaleCommitParticipant participant,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            var operation = StockOperation.CreateSale("sale-1", ean13, new Quantity(command.Quantity!.Value), Now);
            var article = new ArticleSellabilitySnapshot(
                ean13,
                "Article",
                ArticleType.NonFood,
                true,
                null,
                [],
                PackagingCondition.New);
            var position = new StockPositionView(
                ean13,
                "Article",
                ArticleType.NonFood,
                true,
                null,
                [],
                PackagingCondition.New,
                resultingPhysical,
                resultingPhysical,
                StockAvailability.Available,
                null);
            await participant.PrepareAsync(
                new RecordingTransaction(this),
                operation,
                position,
                cancellationToken);
            return new(
                StockSaleStatus.Committed,
                new StockSaleReceipt(operation, position),
                []);
        }

        private sealed class RecordingTransaction(RecordingStockSaleContract owner) : IStockSaleTransaction
        {
            public ValueTask StageAsync(
                StockSaleCommitData data,
                CancellationToken cancellationToken = default)
            {
                owner.ParticipantData = data;
                return ValueTask.CompletedTask;
            }
        }
    }
}
