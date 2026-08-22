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
        Assert.Equal(result.Receipt.Financial, stock.ParticipantData?.FinancialSnapshot);
        Assert.Equal(5, result.Receipt.Position.PhysicalQuantity);
    }

    [Fact]
    public async Task Infers_the_context_for_a_single_mode_food_article_before_committing()
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
            Quantity = 2
        });

        Assert.Equal(SaleStatus.Committed, result.Status);
        Assert.Equal(SaleContext.Takeaway, result.Receipt!.Financial.SaleContext);
        Assert.Equal(new TaxRate("takeaway", 11, 200), result.Receipt.Financial.TaxRate);
        Assert.Equal(202, result.Receipt.Financial.AmountHt.Cents);
        Assert.Equal(11, result.Receipt.Financial.Vat.Cents);
        Assert.Equal(213, result.Receipt.Financial.AmountTtc.Cents);
        Assert.Equal(1, stock.Calls);
    }

    [Fact]
    public async Task Requires_one_context_for_a_food_article_with_two_modes()
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
                [ConsumptionMode.Takeaway, ConsumptionMode.OnSite],
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

        Assert.Equal(SaleStatus.ContextRequired, result.Status);
        Assert.Equal("CONTEXT_REQUIRED", Assert.Single(result.Errors).Code);
        Assert.Equal("context", result.Errors[0].Field);
        Assert.Equal(0, stock.Calls);
    }

    [Fact]
    public async Task Accepts_an_explicit_context_and_rejects_an_incompatible_one()
    {
        var ean13 = ParseEan("0123456789012");
        var article = new ArticleSaleSnapshot(
            ean13,
            "Café torréfié",
            ArticleType.Food,
            true,
            new DateOnly(2030, 1, 15),
            [ConsumptionMode.Takeaway, ConsumptionMode.OnSite],
            null,
            Money.FromCents(101));

        var acceptedStock = new RecordingStockSaleContract(ean13, 5);
        var accepted = await new SaleApplication(
            new FakeArticleSaleReader(article),
            acceptedStock,
            new EmptySaleReader(),
            new FixedClock()).RecordAsync(new SaleCommand
            {
                Ean13 = ean13.Value,
                Quantity = 2,
                Context = "onsite",
                ContextProvided = true
            });

        Assert.Equal(SaleStatus.Committed, accepted.Status);
        Assert.Equal(SaleContext.OnSite, accepted.Receipt!.Financial.SaleContext);
        Assert.Equal(20, accepted.Receipt.Financial.Vat.Cents);

        var rejectedStock = new RecordingStockSaleContract(ean13, 5);
        var rejected = await new SaleApplication(
            new FakeArticleSaleReader(new ArticleSaleSnapshot(
                ean13,
                article.Name,
                article.Type,
                article.IsActive,
                article.Dlc,
                [ConsumptionMode.Takeaway],
                null,
                article.PriceHt)),
            rejectedStock,
            new EmptySaleReader(),
            new FixedClock()).RecordAsync(new SaleCommand
            {
                Ean13 = ean13.Value,
                Quantity = 1,
                Context = "onsite",
                ContextProvided = true
            });

        Assert.Equal(SaleStatus.ContextIncompatible, rejected.Status);
        Assert.Equal("CONTEXT_INCOMPATIBLE", Assert.Single(rejected.Errors).Code);
        Assert.Equal(0, rejectedStock.Calls);
    }

    [Fact]
    public async Task Rejects_a_context_for_a_non_food_article_without_calling_stock()
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
            Quantity = 1,
            Context = "takeaway",
            ContextProvided = true
        });

        Assert.Equal(SaleStatus.ContextNotAllowed, result.Status);
        Assert.Equal("CONTEXT_NOT_ALLOWED", Assert.Single(result.Errors).Code);
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
