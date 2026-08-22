using TokenWarehouse.Application;
using TokenWarehouse.Domain;
using Xunit;

namespace TokenWarehouse.Application.Tests;

public sealed class StockSaleApplicationTests
{
    private static readonly DateTimeOffset Now =
        new(2030, 1, 15, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Records_a_sale_with_the_shared_stock_rules_and_returns_only_stock_facts()
    {
        var ean13 = ParseEan("0123456789012");
        var committer = new FakeCommitter();
        var application = new StockSaleApplication(
            new FakeArticleReader(new ArticleSellabilitySnapshot(
                ean13,
                "Article vendable",
                ArticleType.Food,
                true,
                new DateOnly(2030, 1, 15),
                [ConsumptionMode.Takeaway],
                null,
                4)),
            new FakePositionReader(new StockPosition(ean13, 8, 2)),
            committer,
            new FixedClock());

        var result = await application.RecordAsync(new StockSaleCommand
        {
            Ean13 = ean13.Value,
            Quantity = 3
        });

        Assert.Equal(StockSaleStatus.Committed, result.Status);
        Assert.NotNull(result.Receipt);
        Assert.Equal(StockOperationType.Sale, result.Receipt!.Operation.Type);
        Assert.Equal(ean13, result.Receipt.Operation.Ean13);
        Assert.Equal(3, result.Receipt.Operation.Quantity.Value);
        Assert.Equal(-3, result.Receipt.Operation.Lines.Single().StockEffect);
        Assert.Equal(5, result.Receipt.Position.PhysicalQuantity);
        Assert.Equal(5, result.Receipt.Position.SellableQuantity);
        Assert.Equal(Now, result.Receipt.Operation.TimestampUtc);
        Assert.NotEmpty(result.Receipt.Operation.Id);
        Assert.Equal(1, committer.Calls);
        Assert.Equal(2, committer.Plan?.CurrentPosition?.Version);
        Assert.Equal(5, committer.Plan?.Position.PhysicalQuantity);
    }

    [Fact]
    public async Task Rejects_each_non_sellable_case_without_committing()
    {
        var cases = new[]
        {
            new
            {
                Article = new ArticleSellabilitySnapshot(
                    ParseEan("0123456789012"),
                    "Archivé",
                    ArticleType.Food,
                    false,
                    new DateOnly(2030, 1, 15),
                    [ConsumptionMode.Takeaway],
                    null),
                Position = new StockPosition(ParseEan("0123456789012"), 4),
                Clock = new FixedClock(),
                ExpectedStatus = StockSaleStatus.NotSellable
            },
            new
            {
                Article = new ArticleSellabilitySnapshot(
                    ParseEan("4006381333931"),
                    "Expiré",
                    ArticleType.Food,
                    true,
                    new DateOnly(2030, 1, 14),
                    [ConsumptionMode.Takeaway],
                    null),
                Position = new StockPosition(ParseEan("4006381333931"), 4),
                Clock = new FixedClock(new DateOnly(2030, 1, 15)),
                ExpectedStatus = StockSaleStatus.NotSellable
            },
            new
            {
                Article = new ArticleSellabilitySnapshot(
                    ParseEan("7351353713578"),
                    "Invendable",
                    ArticleType.NonFood,
                    true,
                    null,
                    [],
                    PackagingCondition.Unsellable),
                Position = new StockPosition(ParseEan("7351353713578"), 4),
                Clock = new FixedClock(),
                ExpectedStatus = StockSaleStatus.NotSellable
            },
            new
            {
                Article = new ArticleSellabilitySnapshot(
                    ParseEan("5901234123457"),
                    "Insuffisant",
                    ArticleType.Food,
                    true,
                    new DateOnly(2030, 1, 15),
                    [ConsumptionMode.Takeaway],
                    null),
                Position = new StockPosition(ParseEan("5901234123457"), 2),
                Clock = new FixedClock(),
                ExpectedStatus = StockSaleStatus.OutOfStock
            }
        };

        foreach (var testCase in cases)
        {
            var committer = new FakeCommitter();
            var result = await new StockSaleApplication(
                new FakeArticleReader(testCase.Article),
                new FakePositionReader(testCase.Position),
                committer,
                testCase.Clock).RecordAsync(new StockSaleCommand
                {
                    Ean13 = testCase.Article.Ean13.Value,
                    Quantity = 3
                });

            Assert.Equal(testCase.ExpectedStatus, result.Status);
            Assert.Null(result.Receipt);
            Assert.Equal(0, committer.Calls);
        }
    }

    [Fact]
    public async Task Verification_is_read_only_and_returns_the_same_sellable_position_view()
    {
        var ean13 = ParseEan("0123456789012");
        var committer = new FakeCommitter();
        var result = await new StockSaleApplication(
            new FakeArticleReader(new ArticleSellabilitySnapshot(
                ean13,
                "Article vendable",
                ArticleType.Food,
                true,
                new DateOnly(2030, 1, 15),
                [ConsumptionMode.Takeaway],
                null)),
            new FakePositionReader(new StockPosition(ean13, 8)),
            committer,
            new FixedClock()).CheckSellabilityAsync(new StockSaleCommand
            {
                Ean13 = ean13.Value,
                Quantity = 8
            });

        Assert.Equal(StockSaleStatus.Available, result.Status);
        Assert.Equal(8, result.Position?.PhysicalQuantity);
        Assert.Equal(8, result.Position?.SellableQuantity);
        Assert.Equal(0, committer.Calls);
    }

    [Theory]
    [InlineData(null, 3)]
    [InlineData("not-an-ean", 3)]
    [InlineData("0123456789012", 0)]
    [InlineData("0123456789012", -1)]
    public async Task Rejects_invalid_input_before_reading_or_committing(
        string? ean13,
        int? quantity)
    {
        var committer = new FakeCommitter();
        var result = await new StockSaleApplication(
            new FakeArticleReader(new ArticleSellabilitySnapshot(
                ParseEan("0123456789012"),
                "Article",
                ArticleType.Food,
                true,
                new DateOnly(2030, 1, 15),
                [ConsumptionMode.Takeaway],
                null)),
            new FakePositionReader(new StockPosition(ParseEan("0123456789012"), 8)),
            committer,
            new FixedClock()).RecordAsync(new StockSaleCommand
            {
                Ean13 = ean13,
                Quantity = quantity
            });

        Assert.Equal(StockSaleStatus.ValidationFailed, result.Status);
        Assert.All(result.Errors, error => Assert.Equal("INVALID_INPUT", error.Code));
        Assert.Null(result.Receipt);
        Assert.Equal(0, committer.Calls);
    }

    private static Ean13 ParseEan(string value)
    {
        Assert.True(Ean13.TryCreate(value, out var ean13));
        return ean13;
    }

    private sealed class FixedClock(DateOnly? warehouseDate = null) : IClock
    {
        public DateTimeOffset UtcNow => Now;

        public DateOnly WarehouseDate => warehouseDate ?? DateOnly.FromDateTime(Now.DateTime);
    }

    private sealed class FakeArticleReader(ArticleSellabilitySnapshot article) : IArticleSellabilityReader
    {
        public ValueTask<ArticleSellabilitySnapshot?> FindSellabilityByEanAsync(
            Ean13 ean13,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult<ArticleSellabilitySnapshot?>(
                article.Ean13 == ean13 ? article : null);
    }

    private sealed class FakePositionReader(StockPosition position) : IStockPositionReader
    {
        public ValueTask<IReadOnlyList<StockPosition>> ListAsync(
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult<IReadOnlyList<StockPosition>>([position]);

        public ValueTask<StockPosition?> FindByEanAsync(
            Ean13 ean13,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult<StockPosition?>(position.Ean13 == ean13 ? position : null);
    }

    private sealed class FakeCommitter : IStockMutationCommitter
    {
        public int Calls { get; private set; }

        public StockSaleCommitPlan? Plan { get; private set; }

        public ValueTask<StockMutationCommitResult> CommitAsync(
            InventoryCommitPlan plan,
            CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public ValueTask<StockMutationCommitResult> CommitAsync(
            StockSaleCommitPlan plan,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            Plan = plan;
            return ValueTask.FromResult(StockMutationCommitResult.Committed(plan.Position));
        }
    }
}
