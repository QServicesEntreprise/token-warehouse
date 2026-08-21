using TokenWarehouse.Application;
using TokenWarehouse.Domain;
using Xunit;

namespace TokenWarehouse.Application.Tests;

public sealed class CounterMovementApplicationTests
{
    private static readonly DateTimeOffset Now =
        new(2030, 1, 15, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Corrects_a_supply_from_the_current_position_and_commits_once()
    {
        var ean13 = ParseEan("0123456789012");
        var source = StockOperation.CreateSupply("source-1", ean13, new Quantity(8), Now);
        var committer = new FakeCommitter();
        var application = CreateApplication(source, new StockPosition(ean13, 10), committer);

        var result = await application.CorrectAsync(new CounterMovementCommand
        {
            SourceOperationId = source.Id,
            Justification = " Correction du stock "
        });

        Assert.Equal(CounterMovementRegistrationStatus.Committed, result.Status);
        Assert.Equal(-8, result.Receipt?.Lines[0].InverseEffect);
        Assert.Equal(2, result.Receipt?.Positions[0].PhysicalQuantity);
        Assert.Equal("Correction du stock", result.Receipt?.CounterMovement.Justification);
        Assert.Equal(source, result.Receipt?.Source);
        Assert.Equal(1, committer.Calls);
    }

    [Fact]
    public async Task Rejects_a_blank_justification_before_reading_the_source()
    {
        var reader = new FakeOperationReader(null);
        var committer = new FakeCommitter();
        var application = new CounterMovementApplication(
            new FakeArticleReader([]),
            new FakePositionReader([]),
            committer,
            reader,
            new FixedClock());

        var result = await application.CorrectAsync(new CounterMovementCommand
        {
            SourceOperationId = "source-1",
            Justification = "   "
        });

        Assert.Equal(CounterMovementRegistrationStatus.ValidationFailed, result.Status);
        Assert.Contains(result.Errors, error => error.Code == "INVALID_INPUT");
        Assert.Equal(0, reader.Calls);
        Assert.Equal(0, committer.Calls);
    }

    [Fact]
    public async Task Rejects_a_counter_movement_source_and_negative_result_without_writing()
    {
        var ean13 = ParseEan("0123456789012");
        var source = StockOperation.CreateSupply("source-2", ean13, new Quantity(8), Now);
        var counter = StockOperation.CreateCounterMovement(
            "counter-1",
            source.Id,
            source.Type,
            "Correction",
            CounterMovementPolicy.CreatePlan(source, [new StockPosition(ean13, 10)]).Lines,
            Now);
        var committer = new FakeCommitter();
        var reader = new FakeOperationReader(counter);
        var application = CreateApplication(source, new StockPosition(ean13, 5), committer, reader);

        var counterResult = await application.CorrectAsync(new CounterMovementCommand
        {
            SourceOperationId = counter.Id,
            Justification = "Second correction"
        });
        Assert.Equal(CounterMovementRegistrationStatus.SourceIsCounterMovement, counterResult.Status);
        Assert.Equal(0, committer.Calls);

        reader.Source = source;
        var negativeResult = await application.CorrectAsync(new CounterMovementCommand
        {
            SourceOperationId = source.Id,
            Justification = "Impossible correction"
        });
        Assert.Equal(CounterMovementRegistrationStatus.ResultingStockNegative, negativeResult.Status);
        Assert.Equal(0, committer.Calls);
    }

    private static CounterMovementApplication CreateApplication(
        StockOperation source,
        StockPosition position,
        FakeCommitter committer,
        FakeOperationReader? operationReader = null)
    {
        return new(
            new FakeArticleReader([new ArticleSellabilitySnapshot(
                source.Ean13,
                "Article",
                ArticleType.Food,
                true,
                new DateOnly(2030, 1, 15),
                [ConsumptionMode.Takeaway],
                null,
                1)]),
            new FakePositionReader([position]),
            committer,
            operationReader ?? new FakeOperationReader(source),
            new FixedClock());
    }

    private static Ean13 ParseEan(string value)
    {
        Assert.True(Ean13.TryCreate(value, out var ean13));
        return ean13;
    }

    private sealed class FixedClock : IClock
    {
        public DateTimeOffset UtcNow => Now;
    }

    private sealed class FakeArticleReader(
        IReadOnlyList<ArticleSellabilitySnapshot> articles) : IArticleSellabilityReader
    {
        public ValueTask<ArticleSellabilitySnapshot?> FindSellabilityByEanAsync(
            Ean13 ean13,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult(articles.SingleOrDefault(article => article.Ean13 == ean13));
    }

    private sealed class FakePositionReader(
        IReadOnlyList<StockPosition> positions) : IStockPositionReader
    {
        public ValueTask<IReadOnlyList<StockPosition>> ListAsync(
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult(positions);

        public ValueTask<StockPosition?> FindByEanAsync(
            Ean13 ean13,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult(positions.SingleOrDefault(position => position.Ean13 == ean13));
    }

    private sealed class FakeOperationReader(StockOperation? source) : IStockOperationReader
    {
        public StockOperation? Source { get; set; } = source;

        public int Calls { get; private set; }

        public ValueTask<StockOperation?> FindByIdAsync(
            string id,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            return ValueTask.FromResult(Source?.Id == id ? Source : null);
        }
    }

    private sealed class FakeCommitter : IStockMutationCommitter
    {
        public int Calls { get; private set; }

        public ValueTask<StockMutationCommitResult> CommitAsync(
            InventoryCommitPlan plan,
            CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public ValueTask<StockMutationCommitResult> CommitAsync(
            CounterMovementCommitPlan plan,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            return ValueTask.FromResult(StockMutationCommitResult.Committed(
                plan.Lines.Select(line => new StockPosition(
                    line.Ean13,
                    line.OperationLine.InverseEffect + line.ExpectedPreviousPhysicalStock,
                    line.ExpectedPositionVersion + 1)).ToArray()));
        }
    }
}
