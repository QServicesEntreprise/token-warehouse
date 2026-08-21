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
                null,
                4)),
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
        Assert.Equal(4, committer.Plan?.ExpectedArticleVersion);
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
                PackagingCondition.New,
                2)),
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

    [Fact]
    public async Task Registers_all_bulk_lines_from_one_snapshot_and_one_commit()
    {
        var first = ParseEan("0123456789012");
        var second = ParseEan("7351353713578");
        var articles = new Dictionary<Ean13, ArticleSellabilitySnapshot>
        {
            [first] = new(first, "Premier Article", ArticleType.Food, true, new DateOnly(2030, 1, 15), [ConsumptionMode.Takeaway], null, 3),
            [second] = new(second, "Second Article", ArticleType.NonFood, true, null, [], PackagingCondition.New, 5)
        };
        var positions = new Dictionary<Ean13, StockPosition>
        {
            [first] = new(first, 8),
            [second] = new(second, 5)
        };
        var committer = new BulkFakeCommitter();
        var application = new InventoryApplication(
            new BulkFakeArticleReader(articles),
            new BulkFakePositionReader(positions),
            committer,
            new FixedClock(FixedNow));

        var result = await application.RegisterBulkAsync(new RegisterBulkInventoryCommand
        {
            Lines =
            [
                new() { LineNumber = 1, Ean13 = first.Value, CountedQuantity = 11 },
                new() { LineNumber = 2, Ean13 = second.Value, CountedQuantity = 2 }
            ]
        });

        Assert.Equal(BulkInventoryRegistrationStatus.Committed, result.Status);
        Assert.NotNull(result.Receipt);
        Assert.Equal(2, result.Receipt!.Operation.Lines.Count);
        Assert.Equal(3, result.Receipt.Operation.Lines[0].InventoryDifference);
        Assert.Equal(-3, result.Receipt.Operation.Lines[1].InventoryDifference);
        Assert.Equal(11, result.Receipt.Lines[0].Position.PhysicalQuantity);
        Assert.Equal(2, result.Receipt.Lines[1].Position.PhysicalQuantity);
        Assert.Equal(1, committer.Calls);
        Assert.Equal(2, committer.Plan?.Lines.Count);
        Assert.Equal(8, committer.Plan?.Lines[0].ExpectedPreviousPhysicalStock);
        Assert.Equal(5, committer.Plan?.Lines[1].ExpectedPreviousPhysicalStock);
        Assert.Equal(3, committer.Plan?.Lines[0].ExpectedArticleVersion);
        Assert.Equal(5, committer.Plan?.Lines[1].ExpectedArticleVersion);
    }

    [Fact]
    public async Task Rejects_every_bulk_line_error_before_reading_or_committing()
    {
        var articleReader = new FakeArticleReader(null);
        var positionReader = new FakePositionReader(null);
        var committer = new FakeCommitter();
        var application = new InventoryApplication(
            articleReader,
            positionReader,
            committer,
            new FixedClock(FixedNow));

        var result = await application.RegisterBulkAsync(new RegisterBulkInventoryCommand
        {
            Lines =
            [
                new() { LineNumber = 1, Ean13 = "0123456789012", CountedQuantity = 3 },
                new() { LineNumber = 2, Ean13 = "0123456789012", CountedQuantity = -1 },
                new() { LineNumber = 3, Ean13 = null, CountedQuantity = null }
            ]
        });

        Assert.Equal(BulkInventoryRegistrationStatus.ValidationFailed, result.Status);
        Assert.Null(result.Receipt);
        Assert.Contains(result.Errors, error => error.Field == "lines[1].countedQuantity");
        Assert.Contains(result.Errors, error => error.Field == "lines[2].ean13");
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

        public ValueTask<ArticleSellabilitySnapshot?> FindSellabilityByEanAsync(
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

    private sealed class BulkFakeArticleReader(
        IReadOnlyDictionary<Ean13, ArticleSellabilitySnapshot> articles) : IArticleSellabilityReader
    {
        public ValueTask<ArticleSellabilitySnapshot?> FindSellabilityByEanAsync(
            Ean13 ean13,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult(articles.GetValueOrDefault(ean13));
    }

    private sealed class BulkFakePositionReader(
        IReadOnlyDictionary<Ean13, StockPosition> positions) : IStockPositionReader
    {
        public ValueTask<IReadOnlyList<StockPosition>> ListAsync(
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult<IReadOnlyList<StockPosition>>(positions.Values.ToArray());

        public ValueTask<StockPosition?> FindByEanAsync(
            Ean13 ean13,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult(positions.GetValueOrDefault(ean13));
    }

    private sealed class BulkFakeCommitter : IStockMutationCommitter
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
                    plan.Lines
                        .Select(line => new StockPosition(
                            line.Ean13,
                            line.OperationLine.ResultingPhysicalStock,
                            line.ExpectedPositionVersion + 1))
                        .ToArray()));
        }
    }
}
