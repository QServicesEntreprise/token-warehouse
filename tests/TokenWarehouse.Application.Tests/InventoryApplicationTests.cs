using TokenWarehouse.Application;
using TokenWarehouse.Domain;
using Xunit;

namespace TokenWarehouse.Application.Tests;

public sealed class InventoryApplicationTests
{
    private static readonly DateTimeOffset FixedNow =
        new(2030, 1, 15, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Registers_an_inventory_from_the_current_position_and_returns_the_committed_receipt()
    {
        var ean13 = ParseEan("0123456789012");
        var committer = new FakeCommitter();
        var application = new InventoryApplication(
            new FakeArticleReader(new ArticleSellabilitySnapshot(
                ean13,
                "Article actif",
                ArticleType.Food,
                true,
                new DateOnly(2030, 1, 15),
                [ConsumptionMode.Takeaway],
                null)),
            new FakePositionReader(new StockPosition(ean13, 8)),
            committer,
            new FixedClock(FixedNow));

        var result = await application.RegisterAsync(new RegisterInventoryCommand
        {
            Ean13 = ean13.Value,
            CountedQuantity = 11
        });

        Assert.Equal(InventoryRegistrationStatus.Committed, result.Status);
        Assert.Equal(8, result.Receipt?.Operation.PreviousPhysicalStock);
        Assert.Equal(11, result.Receipt?.Operation.CountedQuantity);
        Assert.Equal(3, result.Receipt?.Operation.InventoryDifference);
        Assert.Equal(11, result.Receipt?.Position.PhysicalQuantity);
        Assert.Equal(11, result.Receipt?.Position.SellableQuantity);
        Assert.Equal(FixedNow, result.Receipt?.Operation.TimestampUtc);
        Assert.NotNull(result.Receipt);
        Assert.NotEmpty(result.Receipt!.Operation.Id);
        Assert.Equal(8, committer.Plan?.ExpectedPreviousPhysicalStock);
    }

    [Fact]
    public async Task Accepts_an_archived_article_but_keeps_its_result_not_sellable()
    {
        var ean13 = ParseEan("4006381333931");
        var committer = new FakeCommitter();
        var application = new InventoryApplication(
            new FakeArticleReader(new ArticleSellabilitySnapshot(
                ean13,
                "Article archivé",
                ArticleType.NonFood,
                false,
                null,
                [],
                PackagingCondition.New)),
            new FakePositionReader(new StockPosition(ean13, 4)),
            committer,
            new FixedClock(FixedNow));

        var result = await application.RegisterAsync(new RegisterInventoryCommand
        {
            Ean13 = ean13.Value,
            CountedQuantity = 2
        });

        Assert.Equal(InventoryRegistrationStatus.Committed, result.Status);
        Assert.Equal(2, result.Receipt?.Position.PhysicalQuantity);
        Assert.Equal(0, result.Receipt?.Position.SellableQuantity);
        Assert.Equal(StockAvailability.NotSellable, result.Receipt?.Position.Availability);
        Assert.Equal(SellabilityReason.Archived, result.Receipt?.Position.Reason);
    }

    [Theory]
    [InlineData(null, 1)]
    [InlineData("0123456789012", null)]
    [InlineData("0123456789012", -1)]
    [InlineData("not-an-ean", 1)]
    public async Task Rejects_invalid_commands_before_reading_or_committing(
        string? ean13,
        int? countedQuantity)
    {
        var articleReader = new FakeArticleReader(null);
        var positionReader = new FakePositionReader(null);
        var committer = new FakeCommitter();
        var application = new InventoryApplication(
            articleReader,
            positionReader,
            committer,
            new FixedClock(FixedNow));

        var result = await application.RegisterAsync(new RegisterInventoryCommand
        {
            Ean13 = ean13,
            CountedQuantity = countedQuantity
        });

        Assert.Equal(InventoryRegistrationStatus.ValidationFailed, result.Status);
        Assert.Null(result.Receipt);
        Assert.Equal(0, articleReader.Calls);
        Assert.Equal(0, positionReader.Calls);
        Assert.Equal(0, committer.Calls);
    }

    private static Ean13 ParseEan(string value)
    {
        Assert.True(Ean13.TryCreate(value, out var ean13));
        return ean13;
    }

    private sealed class FixedClock(DateTimeOffset now) : IClock
    {
        public DateTimeOffset UtcNow => now;
    }

    private sealed class FakeArticleReader(ArticleSellabilitySnapshot? article) : IArticleSellabilityReader
    {
        public int Calls { get; private set; }

        public ValueTask<ArticleSellabilitySnapshot?> FindAsync(
            Ean13 ean13,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            return ValueTask.FromResult(article);
        }
    }

    private sealed class FakePositionReader(StockPosition? position) : IStockPositionReader
    {
        public int Calls { get; private set; }

        public ValueTask<IReadOnlyList<StockPosition>> ListAsync(
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult<IReadOnlyList<StockPosition>>([]);

        public ValueTask<StockPosition?> FindByEanAsync(
            Ean13 ean13,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            return ValueTask.FromResult(position);
        }
    }

    private sealed class FakeCommitter : IStockMutationCommitter
    {
        public int Calls { get; private set; }

        public InventoryCommitPlan? Plan { get; private set; }

        public ValueTask<StockMutationCommitResult> CommitAsync(
            InventoryCommitPlan plan,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            Plan = plan;
            return ValueTask.FromResult(
                StockMutationCommitResult.Committed(
                    new StockPosition(plan.Ean13, plan.Operation.ResultingPhysicalStock)));
        }
    }
}
