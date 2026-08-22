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

    [Fact]
    public async Task Corrects_a_sale_with_the_historical_financial_snapshot()
    {
        var ean13 = ParseEan("0123456789012");
        var source = StockOperation.CreateSale("sale-1", ean13, new Quantity(3), Now);
        var financial = new SaleFinancialSnapshot(
            SaleContext.Takeaway,
            Money.FromCents(1000),
            TaxRate.Takeaway,
            Money.FromCents(1000),
            Money.FromCents(55),
            Money.FromCents(1055));
        var committer = new FakeCommitter();
        var application = CreateApplication(
            source,
            new StockPosition(ean13, 7),
            committer,
            saleReader: new FakeSaleReader(new SaleReadRecord(
                source,
                financial,
                new StockPositionView(
                    ean13,
                    "Article",
                    ArticleType.Food,
                    true,
                    new DateOnly(2030, 1, 15),
                    [ConsumptionMode.Takeaway],
                    null,
                    7,
                    7,
                    StockAvailability.Available,
                    null))));

        var result = await application.CorrectAsync(new CounterMovementCommand
        {
            SourceOperationId = source.Id,
            Justification = "Correction Vente"
        });

        Assert.Equal(CounterMovementRegistrationStatus.Committed, result.Status);
        Assert.Equal(-1000, result.Receipt?.FinancialReversal?.AmountHt.Cents);
        Assert.Equal(-55, result.Receipt?.FinancialReversal?.Vat.Cents);
        Assert.Equal(-1055, result.Receipt?.FinancialReversal?.AmountTtc.Cents);
        Assert.Equal(TaxRate.Takeaway, result.Receipt?.FinancialReversal?.TaxRate);
        Assert.Equal(SaleContext.Takeaway, result.Receipt?.FinancialReversal?.SaleContext);
        Assert.Equal(result.Receipt?.FinancialReversal, committer.LastPlan?.FinancialReversal);
    }

    [Fact]
    public async Task Rejects_a_sale_without_a_historical_financial_snapshot_before_commit()
    {
        var ean13 = ParseEan("0123456789012");
        var source = StockOperation.CreateSale("sale-missing-snapshot", ean13, new Quantity(3), Now);
        var committer = new FakeCommitter();
        var application = CreateApplication(
            source,
            new StockPosition(ean13, 7),
            committer,
            saleReader: new FakeSaleReader(null));

        var result = await application.CorrectAsync(new CounterMovementCommand
        {
            SourceOperationId = source.Id,
            Justification = "Correction sans snapshot"
        });

        Assert.Equal(CounterMovementRegistrationStatus.SaleFinancialSnapshotInvalid, result.Status);
        Assert.Contains(result.Errors, error => error.Code == "SALE_FINANCIAL_SNAPSHOT_INVALID");
        Assert.Equal(0, committer.Calls);
    }

    [Fact]
    public async Task Maps_an_invalid_persisted_sale_snapshot_to_a_conflict_before_commit()
    {
        var ean13 = ParseEan("0123456789012");
        var source = StockOperation.CreateSale("sale-invalid-snapshot", ean13, new Quantity(3), Now);
        var committer = new FakeCommitter();
        var application = CreateApplication(
            source,
            new StockPosition(ean13, 7),
            committer,
            saleReader: new ThrowingSaleReader());

        var result = await application.CorrectAsync(new CounterMovementCommand
        {
            SourceOperationId = source.Id,
            Justification = "Correction snapshot invalide"
        });

        Assert.Equal(CounterMovementRegistrationStatus.SaleFinancialSnapshotInvalid, result.Status);
        Assert.Contains(result.Errors, error => error.Code == "SALE_FINANCIAL_SNAPSHOT_INVALID");
        Assert.Equal(0, committer.Calls);
    }

    [Fact]
    public async Task Lists_a_sale_source_with_its_historical_financial_snapshot()
    {
        var ean13 = ParseEan("0123456789012");
        var source = StockOperation.CreateSale("sale-list-1", ean13, new Quantity(3), Now);
        var financial = new SaleFinancialSnapshot(
            SaleContext.OnSite,
            Money.FromCents(1000),
            TaxRate.OnSite,
            Money.FromCents(3000),
            Money.FromCents(300),
            Money.FromCents(3300));
        var application = CreateApplication(
            source,
            new StockPosition(ean13, 7),
            new FakeCommitter(),
            saleReader: new FakeSaleReader(new SaleReadRecord(
                source,
                financial,
                new StockPositionView(
                    ean13,
                    "Article",
                    ArticleType.Food,
                    true,
                    new DateOnly(2030, 1, 15),
                    [ConsumptionMode.OnSite],
                    null,
                    7,
                    7,
                    StockAvailability.Available,
                    null))));

        var result = await application.ListAsync();

        var listed = Assert.Single(result.Sources);
        Assert.Equal("SALE", listed.Type);
        Assert.Equal(financial, listed.Financial);
    }

    private static CounterMovementApplication CreateApplication(
        StockOperation source,
        StockPosition position,
        FakeCommitter committer,
        FakeOperationReader? operationReader = null,
        ISaleReader? saleReader = null)
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
            new FixedClock(),
            saleReader);
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

        public ValueTask<IReadOnlyList<StockOperation>> ListCorrectableAsync(
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult<IReadOnlyList<StockOperation>>(Source is null ? [] : [Source]);
    }

    private sealed class FakeSaleReader(SaleReadRecord? sale) : ISaleReader
    {
        public ValueTask<SaleReadRecord?> FindByOperationIdAsync(
            string operationId,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult(sale?.Operation.Id == operationId ? sale : null);
    }

    private sealed class ThrowingSaleReader : ISaleReader
    {
        public ValueTask<SaleReadRecord?> FindByOperationIdAsync(
            string operationId,
            CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("Stored Sale snapshot is invalid.");
    }

    private sealed class FakeCommitter : IStockMutationCommitter
    {
        public int Calls { get; private set; }

        public CounterMovementCommitPlan? LastPlan { get; private set; }

        public ValueTask<StockMutationCommitResult> CommitAsync(
            InventoryCommitPlan plan,
            CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public ValueTask<StockMutationCommitResult> CommitAsync(
            CounterMovementCommitPlan plan,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            LastPlan = plan;
            return ValueTask.FromResult(StockMutationCommitResult.Committed(
                plan.Lines.Select(line => new StockPosition(
                    line.Ean13,
                    line.OperationLine.InverseEffect + line.ExpectedPreviousPhysicalStock,
                    line.ExpectedPositionVersion + 1)).ToArray()));
        }
    }
}
