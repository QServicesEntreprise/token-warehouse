using TokenWarehouse.Application;
using TokenWarehouse.Domain;
using Xunit;

namespace TokenWarehouse.Application.Tests;

public sealed class BulkSupplyApplicationTests
{
    private static readonly DateTimeOffset FixedNow =
        new(2030, 1, 15, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Valid_bulk_supply_reads_all_lines_and_commits_once_in_request_order()
    {
        var first = ParseEan("0123456789012");
        var second = ParseEan("5901234123457");
        var reader = new FakeArticleReader(
            new ArticleSellabilitySnapshot(first, "Premier", ArticleType.Food, true, new DateOnly(2030, 1, 15), [ConsumptionMode.Takeaway], null),
            new ArticleSellabilitySnapshot(second, "Second", ArticleType.Food, true, new DateOnly(2030, 1, 15), [ConsumptionMode.Takeaway], null));
        var positions = new FakePositionReader(
            new StockPosition(first, 8),
            new StockPosition(second, 5));
        var committer = new FakeBulkCommitter();
        var application = new SupplyApplication(
            reader,
            positions,
            committer,
            new FixedClock(FixedNow));

        var result = await application.RecordBulkAsync(new BulkSupplyCommand
        {
            Lines =
            [
                new() { Ean13 = first.Value, Quantity = 3 },
                new() { Ean13 = second.Value, Quantity = 2 }
            ]
        });

        Assert.Equal(BulkSupplyStatus.Committed, result.Status);
        Assert.NotNull(result.Receipt);
        Assert.Equal(2, result.Receipt!.Operation.Lines.Count);
        Assert.Equal(first, result.Receipt.Operation.Lines[0].Ean13);
        Assert.Equal(second, result.Receipt.Operation.Lines[1].Ean13);
        Assert.Equal(11, result.Receipt.Positions[0].PhysicalQuantity);
        Assert.Equal(7, result.Receipt.Positions[1].PhysicalQuantity);
        Assert.Equal(FixedNow, result.Receipt.Operation.OccurredAt);
        Assert.Equal(1, committer.Calls);
    }

    [Fact]
    public async Task Invalid_bulk_line_rejects_the_whole_command_before_any_read_or_commit()
    {
        var reader = new FakeArticleReader();
        var positions = new FakePositionReader();
        var committer = new FakeBulkCommitter();
        var application = new SupplyApplication(
            reader,
            positions,
            committer,
            new FixedClock(FixedNow));

        var result = await application.RecordBulkAsync(new BulkSupplyCommand
        {
            Lines =
            [
                new() { Ean13 = "0123456789012", Quantity = 3 },
                new() { Ean13 = "5901234123457", Quantity = 0 }
            ]
        });

        Assert.Equal(BulkSupplyStatus.ValidationFailed, result.Status);
        Assert.Null(result.Receipt);
        Assert.Equal(0, reader.Calls);
        Assert.Equal(0, positions.Calls);
        Assert.Equal(0, committer.Calls);
        Assert.Contains(result.Errors, error => error.Field == "lines[1].quantity");
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

    private sealed class FakeArticleReader(params ArticleSellabilitySnapshot[] snapshots)
        : IArticleSellabilityReader, IArticleSellabilityBatchReader
    {
        private readonly IReadOnlyDictionary<Ean13, ArticleSellabilitySnapshot> articles =
            snapshots.ToDictionary(article => article.Ean13);

        public int Calls { get; private set; }

        public ValueTask<ArticleSellabilitySnapshot?> FindSellabilityByEanAsync(
            Ean13 ean13,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult(articles.GetValueOrDefault(ean13));

        public ValueTask<IReadOnlyDictionary<Ean13, ArticleSellabilitySnapshot>> FindSellabilityByEansAsync(
            IReadOnlyList<Ean13> eans,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            return ValueTask.FromResult<IReadOnlyDictionary<Ean13, ArticleSellabilitySnapshot>>(
                eans.Distinct().Where(articles.ContainsKey).ToDictionary(ean => ean, ean => articles[ean]));
        }
    }

    private sealed class FakePositionReader(params StockPosition[] initialPositions) : IStockPositionReader
    {
        private readonly IReadOnlyList<StockPosition> positions = initialPositions;

        public int Calls { get; private set; }

        public ValueTask<IReadOnlyList<StockPosition>> ListAsync(CancellationToken cancellationToken = default)
        {
            Calls++;
            return ValueTask.FromResult(positions);
        }

        public ValueTask<StockPosition?> FindByEanAsync(
            Ean13 ean13,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult(positions.SingleOrDefault(position => position.Ean13 == ean13));
    }

    private sealed class FakeBulkCommitter : ISupplyCommitter
    {
        public int Calls { get; private set; }

        public ValueTask<SupplyCommitResult> CommitAsync(
            SupplyCommitRequest request,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult(new SupplyCommitResult(
                SupplyCommitStatus.Committed,
                request.Position,
                request.Operation));

        public ValueTask<BulkSupplyCommitResult> CommitAsync(
            BulkSupplyCommitRequest request,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            return ValueTask.FromResult(BulkSupplyCommitResult.Committed(
                request.Operation,
                request.Lines.Select(line => line.Position).ToArray()));
        }
    }
}
