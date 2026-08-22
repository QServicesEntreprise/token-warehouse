using TokenWarehouse.Application;
using TokenWarehouse.Domain;
using Xunit;

namespace TokenWarehouse.Application.Tests;

public sealed class ArticleApplicationTests
{
    private static readonly IClock TestClock = new FixedClock(
        new DateTimeOffset(2026, 8, 21, 10, 30, 0, TimeSpan.Zero));

    [Fact]
    public async Task Creates_and_reads_an_article_through_the_store_seam()
    {
        var store = new InMemoryArticleStore();
        var application = CreateApplication(store);
        var command = new CreateArticleCommand
        {
            Ean13 = "0123456789012",
            Type = "food",
            Name = "Chocolat noir",
            PriceHtCents = 199,
            Dlc = "2026-12-31",
            ConsumptionModes = ["takeaway", "onsite"]
        };

        var created = await application.CreateAsync(command);
        var read = await application.GetAsync(command.Ean13!);

        Assert.Equal(ArticleCreateStatus.Created, created.Status);
        Assert.Equal(ArticleReadStatus.Found, read.Status);
        Assert.Equal("0123456789012", read.Article?.Ean13.Value);
        Assert.Equal(ArticleType.Food, read.Article?.Type);
        Assert.Equal([ConsumptionMode.Takeaway, ConsumptionMode.OnSite], read.Article?.ConsumptionModes);
        Assert.Equal(199, read.Article?.PriceHt.Cents);
        Assert.Equal(new DateOnly(2026, 12, 31), read.Article?.Dlc);
        Assert.True(read.Article?.IsActive);
        Assert.Equal(1, store.InsertCalls);
    }

    [Fact]
    public async Task Archives_an_article_and_records_one_immutable_lifecycle_fact()
    {
        var store = new InMemoryArticleStore();
        var application = CreateApplication(store);
        const string ean13 = "0123456789012";

        await application.CreateAsync(new CreateArticleCommand
        {
            Ean13 = ean13,
            Type = "food",
            Name = "Chocolat noir",
            PriceHtCents = 199,
            Dlc = "2026-12-31",
            ConsumptionModes = ["takeaway"]
        });

        var result = await application.ChangeLifecycleAsync(ean13, ArticleLifecycleStatus.Archived);
        var history = await application.GetHistoryAsync(ean13);

        Assert.Equal(ArticleLifecycleChangeStatus.Updated, result.Status);
        Assert.False(result.Article?.IsActive);
        Assert.Equal(199, result.Article?.PriceHt.Cents);
        var fact = Assert.Single(history.Facts);
        Assert.Equal(ean13, fact.Ean13.Value);
        Assert.Equal(ArticleLifecycleStatus.Active, fact.PreviousStatus);
        Assert.Equal(ArticleLifecycleStatus.Archived, fact.NextStatus);
        Assert.Equal(new DateTimeOffset(2026, 8, 21, 10, 30, 0, TimeSpan.Zero), fact.OccurredAt);
        Assert.Equal(1, store.TransitionCalls);
    }

    [Fact]
    public async Task A_failed_lifecycle_persistence_leaves_the_previous_state_and_history_unchanged()
    {
        var store = new InMemoryArticleStore
        {
            TransitionError = new InvalidOperationException("history write failed")
        };
        var application = CreateApplication(store);
        const string ean13 = "7351353713578";

        await application.CreateAsync(new CreateArticleCommand
        {
            Ean13 = ean13,
            Type = "nonFood",
            Name = "Batterie",
            PriceHtCents = 2500,
            Packaging = "new"
        });

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => application.ChangeLifecycleAsync(ean13, ArticleLifecycleStatus.Archived));

        var article = await application.GetAsync(ean13);
        var history = await application.GetHistoryAsync(ean13);
        Assert.True(article.Article?.IsActive);
        Assert.Empty(history.Facts);
    }

    [Fact]
    public async Task Invalid_creation_is_reported_without_writing()
    {
        var store = new InMemoryArticleStore();
        var application = CreateApplication(store);

        var result = await application.CreateAsync(new CreateArticleCommand
        {
            Ean13 = "0123456789013",
            Type = "food",
            Name = "Chocolat noir",
            PriceHtCents = 199,
            Dlc = "2026-12-31",
            ConsumptionModes = ["takeaway"]
        });

        Assert.Equal(ArticleCreateStatus.ValidationFailed, result.Status);
        Assert.Contains(result.Errors, error => error.Code == "article.ean13.invalid");
        Assert.Equal(0, store.InsertCalls);
    }

    [Fact]
    public async Task Repeated_ean_returns_a_stable_conflict()
    {
        var store = new InMemoryArticleStore();
        var application = CreateApplication(store);
        var command = new CreateArticleCommand
        {
            Ean13 = "4006381333931",
            Type = "nonFood",
            Name = "Batterie",
            PriceHtCents = 2500,
            Packaging = "refurbished"
        };

        Assert.Equal(ArticleCreateStatus.Created, (await application.CreateAsync(command)).Status);
        var conflict = await application.CreateAsync(command);

        Assert.Equal(ArticleCreateStatus.Conflict, conflict.Status);
        Assert.Contains(conflict.Errors, error => error.Code == "article.ean13.conflict" && error.Field == "ean13");
        Assert.Equal(1, store.InsertCalls);
    }

    [Fact]
    public async Task Lists_articles_with_a_normalized_typed_filter()
    {
        var store = new InMemoryArticleStore
        {
            ListResult =
            [
                CreateArticle("0123456789012", "food", "Café de la Place", ["takeaway"])
            ]
        };
        var application = CreateApplication(store);

        var result = await application.ListAsync(new ArticleListQuery
        {
            Search = "  café ",
            Type = "food",
            Mode = "takeaway"
        });

        Assert.Equal(ArticleListStatus.Success, result.Status);
        Assert.Equal("Café de la Place", Assert.Single(result.Articles).Name);
        Assert.Equal(
            new ArticleListFilter(
                ArticleLifecycleFilter.Active,
                "café",
                ArticleType.Food,
                ConsumptionMode.Takeaway,
                null),
            store.LastListFilter);
        Assert.Equal(0, store.InsertCalls);
    }

    [Fact]
    public async Task Lists_explicit_archived_and_all_views_without_mutation()
    {
        var store = new InMemoryArticleStore
        {
            ListResult =
            [
                CreateArticle("4006381333931", "nonFood", "Batterie archivée", null, false),
                CreateArticle("7351353713578", "nonFood", "Batterie active", null)
            ]
        };
        var application = CreateApplication(store);

        var archived = await application.ListAsync(new ArticleListQuery { Status = "archived" });
        var all = await application.ListAsync(new ArticleListQuery { Status = "all" });

        Assert.Equal(ArticleListStatus.Success, archived.Status);
        Assert.Equal(ArticleListStatus.Success, all.Status);
        Assert.False(Assert.Single(archived.Articles).IsActive);
        Assert.Equal(2, all.Articles.Count);
        Assert.Equal(ArticleLifecycleFilter.All, store.LastListFilter?.Status);
        Assert.Equal(0, store.InsertCalls);
    }

    [Fact]
    public async Task Keeps_a_valid_empty_catalogue_as_a_successful_read()
    {
        var store = new InMemoryArticleStore();
        var application = CreateApplication(store);

        var result = await application.ListAsync(new ArticleListQuery { Search = "aucun résultat" });

        Assert.Equal(ArticleListStatus.Success, result.Status);
        Assert.Empty(result.Articles);
        Assert.Equal("aucun résultat", store.LastListFilter?.Search);
        Assert.Equal(0, store.InsertCalls);
    }

    [Theory]
    [InlineData("status", "retired")]
    [InlineData("type", "grocery")]
    [InlineData("mode", "delivery")]
    [InlineData("packaging", "damaged")]
    public async Task Invalid_list_filters_are_reported_without_calling_the_store(string field, string value)
    {
        var store = new InMemoryArticleStore();
        var application = CreateApplication(store);
        var query = field switch
        {
            "status" => new ArticleListQuery { Status = value },
            "type" => new ArticleListQuery { Type = value },
            "mode" => new ArticleListQuery { Mode = value },
            _ => new ArticleListQuery { Packaging = value }
        };

        var result = await application.ListAsync(query);

        Assert.Equal(ArticleListStatus.ValidationFailed, result.Status);
        Assert.Contains(result.Errors, error => error.Field == field);
        Assert.Null(store.LastListFilter);
    }

    [Fact]
    public async Task Updates_ht_and_returns_recalculated_quotes_through_the_store_seam()
    {
        var store = new InMemoryArticleStore();
        var application = CreateApplication(store);
        var command = new CreateArticleCommand
        {
            Ean13 = "0123456789012",
            Type = "food",
            Name = "Chocolat noir",
            PriceHtCents = 1000,
            Dlc = "2026-12-31",
            ConsumptionModes = ["takeaway", "onsite"]
        };

        await application.CreateAsync(command);
        var result = await application.UpdatePriceHtAsync(
            command.Ean13!,
            new UpdateArticlePriceCommand { PriceHtCents = 199 });

        Assert.Equal(ArticleUpdateStatus.Updated, result.Status);
        Assert.Equal(199, result.Article?.PriceHt.Cents);
        Assert.Equal(
            new[] { 210, 219 },
            result.Article?.PriceQuotes.Select(quote => quote.PriceTtc.Cents).ToArray());
        Assert.Equal(1, store.UpdateCalls);
        Assert.Equal(199, store.UpdatedArticle?.PriceHt.Cents);
    }

    [Fact]
    public async Task Rejects_invalid_price_updates_without_writing()
    {
        var store = new InMemoryArticleStore();
        var application = CreateApplication(store);
        var command = new CreateArticleCommand
        {
            Ean13 = "7351353713578",
            Type = "nonFood",
            Name = "Batterie",
            PriceHtCents = 1000,
            Packaging = "new"
        };

        await application.CreateAsync(command);
        var result = await application.UpdatePriceHtAsync(
            command.Ean13!,
            new UpdateArticlePriceCommand
            {
                PriceHtCents = null,
                UnsupportedFields = ["priceTtcCents"]
            });

        Assert.Equal(ArticleUpdateStatus.ValidationFailed, result.Status);
        Assert.Contains(result.Errors, error => error.Code == "article.priceHtCents.required");
        Assert.Contains(result.Errors, error => error.Code == "article.field.unsupported");
        Assert.Equal(0, store.UpdateCalls);
        Assert.Equal(1000, (await application.GetAsync(command.Ean13!)).Article?.PriceHt.Cents);
    }

    [Fact]
    public async Task Maps_a_store_update_conflict_without_changing_the_loaded_article()
    {
        var store = new InMemoryArticleStore { UpdateStatus = ArticleStoreUpdateStatus.Conflict };
        var application = CreateApplication(store);
        var command = new CreateArticleCommand
        {
            Ean13 = "7351353713578",
            Type = "nonFood",
            Name = "Batterie",
            PriceHtCents = 1000,
            Packaging = "new"
        };

        await application.CreateAsync(command);
        var result = await application.UpdatePriceHtAsync(
            command.Ean13!,
            new UpdateArticlePriceCommand { PriceHtCents = 199 });

        Assert.Equal(ArticleUpdateStatus.Conflict, result.Status);
        Assert.Equal(1000, (await application.GetAsync(command.Ean13!)).Article?.PriceHt.Cents);
    }

    [Fact]
    public async Task Updates_food_attributes_and_records_the_before_after_history_fact()
    {
        var store = new InMemoryArticleStore();
        var application = CreateApplication(store);
        const string ean13 = "0123456789012";

        await application.CreateAsync(new CreateArticleCommand
        {
            Ean13 = ean13,
            Type = "food",
            Name = "Chocolat noir",
            PriceHtCents = 199,
            Dlc = "2026-12-31",
            ConsumptionModes = ["takeaway"]
        });

        var result = await application.UpdateAttributesAsync(ean13, new UpdateArticleAttributesCommand
        {
            Name = "Chocolat noir bio",
            NameProvided = true,
            Dlc = "2027-01-31",
            DlcProvided = true,
            ConsumptionModes = ["takeaway", "onsite"],
            ConsumptionModesProvided = true
        });

        Assert.Equal(ArticleUpdateStatus.Updated, result.Status);
        Assert.Equal("Chocolat noir bio", result.Article?.Name);
        Assert.Equal(new DateOnly(2027, 1, 31), result.Article?.Dlc);
        Assert.Equal([ConsumptionMode.Takeaway, ConsumptionMode.OnSite], result.Article?.ConsumptionModes);
        Assert.Equal(199, result.Article?.PriceHt.Cents);
        Assert.Equal(1, store.AttributeUpdateCalls);

        var fact = Assert.Single((await application.GetHistoryAsync(ean13)).Facts);
        Assert.Equal(ean13, fact.Ean13.Value);
        Assert.Equal(
            ["name", "dlc", "consumptionModes"],
            fact.Changes.Select(change => change.Field).ToArray());
        Assert.Equal("Chocolat noir", fact.Changes[0].PreviousValue);
        Assert.Equal("Chocolat noir bio", fact.Changes[0].NextValue);
        Assert.Equal("2026-12-31", fact.Changes[1].PreviousValue);
        Assert.Equal("2027-01-31", fact.Changes[1].NextValue);
        Assert.Equal("takeaway", fact.Changes[2].PreviousValue);
        Assert.Equal("takeaway,onsite", fact.Changes[2].NextValue);
    }

    [Fact]
    public async Task Rejects_invalid_attribute_updates_without_writing_article_or_history()
    {
        var store = new InMemoryArticleStore();
        var application = CreateApplication(store);
        const string ean13 = "7351353713578";

        await application.CreateAsync(new CreateArticleCommand
        {
            Ean13 = ean13,
            Type = "nonFood",
            Name = "Batterie",
            PriceHtCents = 2500,
            Packaging = "new"
        });

        var result = await application.UpdateAttributesAsync(ean13, new UpdateArticleAttributesCommand
        {
            Packaging = "unknown",
            PackagingProvided = true,
            UnsupportedFields = ["type"]
        });

        Assert.Equal(ArticleUpdateStatus.ValidationFailed, result.Status);
        Assert.Contains(result.Errors, error => error.Code == "article.packaging.invalid");
        Assert.Contains(result.Errors, error => error.Code == "article.field.unsupported");
        Assert.Equal(0, store.AttributeUpdateCalls);
        Assert.Equal("Batterie", (await application.GetAsync(ean13)).Article?.Name);
        Assert.Empty((await application.GetHistoryAsync(ean13)).Facts);
    }

    [Fact]
    public async Task Refuses_direct_attribute_update_of_an_archived_article()
    {
        var store = new InMemoryArticleStore();
        var application = CreateApplication(store);
        const string ean13 = "4006381333931";

        await application.CreateAsync(new CreateArticleCommand
        {
            Ean13 = ean13,
            Type = "nonFood",
            Name = "Batterie",
            PriceHtCents = 2500,
            Packaging = "new"
        });
        await application.ChangeLifecycleAsync(ean13, ArticleLifecycleStatus.Archived);

        var result = await application.UpdateAttributesAsync(ean13, new UpdateArticleAttributesCommand
        {
            Name = "Batterie archivée",
            NameProvided = true
        });

        Assert.Equal(ArticleUpdateStatus.Conflict, result.Status);
        Assert.Contains(result.Errors, error => error.Code == "article.update.archived");
        Assert.Equal(0, store.AttributeUpdateCalls);
        Assert.Equal("Batterie", (await application.GetAsync(ean13)).Article?.Name);
    }

    [Fact]
    public async Task Stock_read_returns_one_ordered_position_per_article_and_fills_missing_stock_with_zero()
    {
        var active = CreateArticle("0123456789012", "food", "Alimentaire double mode", ["takeaway", "onsite"]);
        var archived = CreateArticle("4006381333931", "nonFood", "Infrastructure archivée", null, isActive: false);
        var withoutPosition = CreateArticle("7351353713578", "nonFood", "Infrastructure sans position", null);
        var stockReader = new InMemoryStockReadReader(
            [
                ArticleSellabilitySnapshot.From(withoutPosition),
                ArticleSellabilitySnapshot.From(archived),
                ArticleSellabilitySnapshot.From(active)
            ],
            [
                new StockPosition(archived.Ean13, 4),
                new StockPosition(active.Ean13, 5)
            ]);
        var application = new StockApplication(stockReader, TestClock);

        var result = await application.ListAsync();

        Assert.Equal(StockReadStatus.Success, result.Status);
        Assert.Equal(
            ["0123456789012", "4006381333931", "7351353713578"],
            result.Positions.Select(position => position.Ean13.Value).ToArray());
        Assert.Equal((5, 5, StockAvailability.Available, null),
            (result.Positions[0].PhysicalQuantity,
             result.Positions[0].SellableQuantity,
             result.Positions[0].Availability,
             result.Positions[0].Reason));
        Assert.Equal((4, 0, StockAvailability.NotSellable, SellabilityReason.Archived),
            (result.Positions[1].PhysicalQuantity,
             result.Positions[1].SellableQuantity,
             result.Positions[1].Availability,
             result.Positions[1].Reason));
        Assert.Equal((0, 0, StockAvailability.OutOfStock, null),
            (result.Positions[2].PhysicalQuantity,
             result.Positions[2].SellableQuantity,
             result.Positions[2].Availability,
             result.Positions[2].Reason));
        Assert.Equal(1, stockReader.Calls);
    }

    [Fact]
    public async Task Records_a_supply_and_returns_the_committed_position_and_sellability()
    {
        var store = new InMemoryArticleStore();
        var articleApplication = CreateApplication(store);
        await articleApplication.CreateAsync(new CreateArticleCommand
        {
            Ean13 = "0123456789012",
            Type = "food",
            Name = "Alimentaire DLC du jour",
            PriceHtCents = 100,
            Dlc = "2026-08-21",
            ConsumptionModes = ["takeaway"]
        });

        var positions = new List<StockPosition> { new(CreateEan("0123456789012"), 8) };
        var operations = new List<StockOperation>();
        var supply = new SupplyApplication(
            store,
            new InMemoryStockPositionReader(positions),
            new InMemorySupplyCommitter(positions, operations),
            TestClock);

        var result = await supply.RecordAsync(new SupplyCommand
        {
            Ean13 = "0123456789012",
            Quantity = 3
        });

        Assert.Equal(SupplyStatus.Committed, result.Status);
        Assert.Equal(11, result.Receipt?.Position.PhysicalQuantity);
        Assert.Equal(11, result.Receipt?.Position.SellableQuantity);
        Assert.Equal(3, result.Receipt?.Operation.Quantity.Value);
        Assert.Equal(new DateTimeOffset(2026, 8, 21, 10, 30, 0, TimeSpan.Zero), result.Receipt?.Operation.OccurredAt);
        Assert.Single(operations);
    }

    [Fact]
    public async Task Leaves_position_and_history_unchanged_when_commit_rolls_back()
    {
        var store = new InMemoryArticleStore();
        var articleApplication = CreateApplication(store);
        await articleApplication.CreateAsync(new CreateArticleCommand
        {
            Ean13 = "0123456789012",
            Type = "food",
            Name = "Article existant",
            PriceHtCents = 100,
            Dlc = "2026-12-31",
            ConsumptionModes = ["takeaway"]
        });

        var ean13 = CreateEan("0123456789012");
        var positions = new List<StockPosition> { new(ean13, 4) };
        Assert.True(Quantity.TryCreatePositive(1, out var sourceQuantity));
        var source = StockOperation.CreateSupply("source-operation", ean13, sourceQuantity, TestClock.UtcNow);
        var operations = new List<StockOperation> { source };
        var supply = new SupplyApplication(
            store,
            new InMemoryStockPositionReader(positions),
            new RollingBackSupplyCommitter(positions, operations),
            TestClock);

        var result = await supply.RecordAsync(new SupplyCommand
        {
            Ean13 = ean13.Value,
            Quantity = 2
        });

        Assert.Equal(SupplyStatus.Conflict, result.Status);
        Assert.Equal(4, Assert.Single(positions).PhysicalQuantity);
        Assert.Equal([source], operations);
    }

    [Fact]
    public async Task Rejects_invalid_or_archived_supplies_before_the_commit_seam()
    {
        var store = new InMemoryArticleStore();
        var articleApplication = CreateApplication(store);
        await articleApplication.CreateAsync(new CreateArticleCommand
        {
            Ean13 = "7351353713578",
            Type = "nonFood",
            Name = "Batterie",
            PriceHtCents = 100,
            Packaging = "new"
        });
        await articleApplication.ChangeLifecycleAsync("7351353713578", ArticleLifecycleStatus.Archived);

        var positions = new List<StockPosition>();
        var committer = new InMemorySupplyCommitter(positions, []);
        var supply = new SupplyApplication(
            store,
            new InMemoryStockPositionReader(positions),
            committer,
            TestClock);

        var invalid = await supply.RecordAsync(new SupplyCommand
        {
            Ean13 = "7351353713578",
            Quantity = 0
        });
        var archived = await supply.RecordAsync(new SupplyCommand
        {
            Ean13 = "7351353713578",
            Quantity = 2
        });
        var unknown = await supply.RecordAsync(new SupplyCommand
        {
            Ean13 = "4006381333931",
            Quantity = 2
        });

        Assert.Equal(SupplyStatus.ValidationFailed, invalid.Status);
        Assert.Equal(SupplyStatus.Conflict, archived.Status);
        Assert.Equal(SupplyStatus.NotFound, unknown.Status);
        Assert.Empty(positions);
        Assert.Equal(0, committer.Calls);
    }

    [Fact]
    public async Task Keeps_previous_operations_immutable_across_successive_supplies()
    {
        var store = new InMemoryArticleStore();
        var articleApplication = CreateApplication(store);
        await articleApplication.CreateAsync(new CreateArticleCommand
        {
            Ean13 = "0123456789012",
            Type = "food",
            Name = "Chocolat",
            PriceHtCents = 100,
            Dlc = "2026-12-31",
            ConsumptionModes = ["takeaway"]
        });

        var positions = new List<StockPosition>();
        var operations = new List<StockOperation>();
        var supply = new SupplyApplication(
            store,
            new InMemoryStockPositionReader(positions),
            new InMemorySupplyCommitter(positions, operations),
            TestClock);

        var first = await supply.RecordAsync(new SupplyCommand { Ean13 = "0123456789012", Quantity = 2 });
        var firstSnapshot = first.Receipt!.Operation;
        var second = await supply.RecordAsync(new SupplyCommand { Ean13 = "0123456789012", Quantity = 3 });

        Assert.Equal(5, second.Receipt?.Position.PhysicalQuantity);
        Assert.Equal(2, firstSnapshot.Quantity.Value);
        Assert.Equal(2, operations[0].Quantity.Value);
        Assert.Equal(3, operations[1].Quantity.Value);
        Assert.NotEqual(operations[0].Id, operations[1].Id);
        Assert.Single(positions);
    }

    private static Article CreateArticle(
        string ean13,
        string type,
        string name,
        IReadOnlyList<string>? modes,
        bool isActive = true)
    {
        var result = Article.Reconstitute(
            new ArticleDraft
            {
                Ean13 = ean13,
                Type = type,
                Name = name,
                PriceHtCents = 100,
                Dlc = type == "food" ? "2026-12-31" : null,
                DlcProvided = type == "food",
                ConsumptionModes = modes,
                ConsumptionModesProvided = modes is not null,
                Packaging = type == "nonFood" ? "new" : null,
                PackagingProvided = type == "nonFood"
            },
            isActive);

        return Assert.IsType<Article>(result.Value);
    }

    private static Ean13 CreateEan(string value)
    {
        Assert.True(Ean13.TryCreate(value, out var ean13));
        return ean13;
    }

    private static ArticleApplication CreateApplication(InMemoryArticleStore store) =>
        new(store, TestClock);

    private sealed class FixedClock(DateTimeOffset now) : IClock
    {
        public DateTimeOffset UtcNow => now;
    }

    private sealed class InMemoryStockReadReader(
        IReadOnlyList<ArticleSellabilitySnapshot> articles,
        IReadOnlyList<StockPosition> positions) : IStockReadReader
    {
        public int Calls { get; private set; }

        public ValueTask<StockReadSnapshot> ReadAsync(
            Ean13? ean13 = null,
            CancellationToken cancellationToken = default,
            DashboardArticleSelection? selection = null)
        {
            Calls++;
            return ValueTask.FromResult(new StockReadSnapshot(articles, positions));
        }
    }

    private sealed class InMemoryStockPositionReader(IList<StockPosition> positions) : IStockPositionReader
    {
        public ValueTask<IReadOnlyList<StockPosition>> ListAsync(CancellationToken cancellationToken = default)
            => ValueTask.FromResult<IReadOnlyList<StockPosition>>(positions.ToArray());

        public ValueTask<StockPosition?> FindByEanAsync(
            Ean13 ean13,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult(positions.SingleOrDefault(position => position.Ean13 == ean13));
    }

    private sealed class InMemorySupplyCommitter(
        IList<StockPosition> positions,
        IList<StockOperation> operations) : ISupplyCommitter
    {
        public int Calls { get; private set; }

        public ValueTask<SupplyCommitResult> CommitAsync(
            SupplyCommitRequest request,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            if (request.CurrentPosition is { } current)
            {
                positions[positions.IndexOf(current)] = request.Position;
            }
            else
            {
                positions.Add(request.Position);
            }

            operations.Add(request.Operation);
            return ValueTask.FromResult(new SupplyCommitResult(
                SupplyCommitStatus.Committed,
                request.Position,
                request.Operation));
        }
    }

    private sealed class RollingBackSupplyCommitter(
        IList<StockPosition> positions,
        IList<StockOperation> operations) : ISupplyCommitter
    {
        public ValueTask<SupplyCommitResult> CommitAsync(
            SupplyCommitRequest request,
            CancellationToken cancellationToken = default)
        {
            var previousPositions = positions.ToArray();
            var previousOperations = operations.ToArray();

            if (request.CurrentPosition is { } current)
            {
                positions[positions.IndexOf(current)] = request.Position;
            }
            else
            {
                positions.Add(request.Position);
            }

            operations.Add(request.Operation);
            positions.Clear();
            foreach (var position in previousPositions)
            {
                positions.Add(position);
            }

            operations.Clear();
            foreach (var operation in previousOperations)
            {
                operations.Add(operation);
            }

            return ValueTask.FromResult(new SupplyCommitResult(SupplyCommitStatus.Conflict, null, null));
        }
    }

    private sealed class InMemoryArticleStore : IArticleStore, IArticleSellabilityReader
    {
        private readonly List<Article> articles = [];
        private readonly List<ArticleLifecycleHistory> history = [];
        private readonly List<ArticleAttributeHistory> attributeHistory = [];

        public int InsertCalls { get; private set; }

        public int TransitionCalls { get; private set; }

        public Exception? TransitionError { get; init; }

        public ArticleStoreUpdateStatus UpdateStatus { get; set; } = ArticleStoreUpdateStatus.Updated;

        public ArticleStorePriceUpdateCandidateStatus PriceUpdateCandidateStatus { get; set; } = ArticleStorePriceUpdateCandidateStatus.Active;

        public Article? UpdatedArticle { get; private set; }

        public int UpdateCalls { get; private set; }

        public int AttributeUpdateCalls { get; private set; }

        public ArticleStoreAttributeUpdateStatus AttributeUpdateStatus { get; set; } = ArticleStoreAttributeUpdateStatus.Updated;

        public ArticleListFilter? LastListFilter { get; private set; }

        public IReadOnlyList<Article> ListResult { get; init; } = [];

        public ValueTask<Article?> FindByEanAsync(Ean13 ean13, CancellationToken cancellationToken = default)
            => ValueTask.FromResult(
                articles.SingleOrDefault(article => article.Ean13 == ean13) is { } article
                    ? Clone(article)
                    : null);

        public ValueTask<ArticleSellabilitySnapshot?> FindSellabilityByEanAsync(
            Ean13 ean13,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult(
                articles.SingleOrDefault(article => article.Ean13 == ean13) is { } article
                    ? ArticleSellabilitySnapshot.From(article)
                    : null);

        public ValueTask<ArticleStoreInsertStatus> InsertAsync(Article article, CancellationToken cancellationToken = default)
        {
            InsertCalls++;
            if (articles.Any(existing => existing.Ean13 == article.Ean13))
            {
                return ValueTask.FromResult(ArticleStoreInsertStatus.Conflict);
            }

            articles.Add(article);
            return ValueTask.FromResult(ArticleStoreInsertStatus.Created);
        }

        public ValueTask<IReadOnlyList<Article>> ListAsync(
            ArticleListFilter filter,
            CancellationToken cancellationToken = default)
        {
            LastListFilter = filter;
            var matches = ListResult.AsEnumerable();
            matches = filter.Status switch
            {
                ArticleLifecycleFilter.Active => matches.Where(article => article.IsActive),
                ArticleLifecycleFilter.Archived => matches.Where(article => !article.IsActive),
                _ => matches
            };

            if (filter.Type is not null)
            {
                matches = matches.Where(article => article.Type == filter.Type);
            }

            if (filter.Search is not null)
            {
                matches = matches.Where(article =>
                    article.Ean13.Value == filter.Search
                    || article.Name.Contains(filter.Search, StringComparison.OrdinalIgnoreCase));
            }

            if (filter.Mode is not null)
            {
                matches = matches.Where(article =>
                    article.Type == ArticleType.Food
                    && article.ConsumptionModes.Contains(filter.Mode.Value));
            }

            if (filter.Packaging is not null)
            {
                matches = matches.Where(article =>
                    article.Type == ArticleType.NonFood
                    && article.Packaging == filter.Packaging);
            }

            return ValueTask.FromResult<IReadOnlyList<Article>>(
                matches.OrderBy(article => article.Name).ThenBy(article => article.Ean13.Value).ToArray());
        }

        public ValueTask<ArticleStoreLifecycleTransitionStatus> TransitionLifecycleAsync(
            Ean13 ean13,
            ArticleLifecycleStatus expectedStatus,
            ArticleLifecycleStatus targetStatus,
            ArticleLifecycleHistory transition,
            CancellationToken cancellationToken = default)
        {
            TransitionCalls++;
            var article = articles.SingleOrDefault(current => current.Ean13 == ean13);
            if (article is null)
            {
                return ValueTask.FromResult(ArticleStoreLifecycleTransitionStatus.NotFound);
            }

            if (article.LifecycleStatus != expectedStatus)
            {
                return ValueTask.FromResult(ArticleStoreLifecycleTransitionStatus.Conflict);
            }

            if (TransitionError is not null)
            {
                throw TransitionError;
            }

            if (targetStatus == ArticleLifecycleStatus.Archived)
            {
                article.Archive();
            }
            else
            {
                article.Reactivate();
            }

            history.Add(transition);
            return ValueTask.FromResult(ArticleStoreLifecycleTransitionStatus.Updated);
        }

        public ValueTask<IReadOnlyList<ArticleLifecycleHistory>> ListLifecycleHistoryAsync(
            Ean13? ean13 = null,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult<IReadOnlyList<ArticleLifecycleHistory>>(
                (ean13 is null
                    ? history
                    : history.Where(fact => fact.Ean13 == ean13.Value))
                .ToArray());

        public ValueTask<ArticleStoreAttributeUpdateStatus> UpdateAttributesAsync(
            Article article,
            ArticleAttributeHistory changes,
            CancellationToken cancellationToken = default)
        {
            AttributeUpdateCalls++;
            var index = articles.FindIndex(current => current.Ean13 == article.Ean13);
            if (index < 0)
            {
                return ValueTask.FromResult(ArticleStoreAttributeUpdateStatus.NotFound);
            }

            if (!articles[index].IsActive || AttributeUpdateStatus != ArticleStoreAttributeUpdateStatus.Updated)
            {
                return ValueTask.FromResult(
                    !articles[index].IsActive
                        ? ArticleStoreAttributeUpdateStatus.Conflict
                        : AttributeUpdateStatus);
            }

            articles[index] = article;
            attributeHistory.Add(changes);
            return ValueTask.FromResult(ArticleStoreAttributeUpdateStatus.Updated);
        }

        public ValueTask<IReadOnlyList<ArticleAttributeHistory>> ListAttributeHistoryAsync(
            Ean13? ean13 = null,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult<IReadOnlyList<ArticleAttributeHistory>>(
                (ean13 is null
                    ? attributeHistory
                    : attributeHistory.Where(fact => fact.Ean13 == ean13.Value))
                .ToArray());

        public ValueTask<ArticleStorePriceUpdateCandidate> FindForPriceUpdateAsync(
            Ean13 ean13,
            CancellationToken cancellationToken = default)
        {
            var article = articles.SingleOrDefault(existing => existing.Ean13 == ean13);
            return PriceUpdateCandidateStatus switch
            {
                ArticleStorePriceUpdateCandidateStatus.NotFound => ValueTask.FromResult(
                    new ArticleStorePriceUpdateCandidate(ArticleStorePriceUpdateCandidateStatus.NotFound, null)),
                ArticleStorePriceUpdateCandidateStatus.Archived => ValueTask.FromResult(
                    new ArticleStorePriceUpdateCandidate(ArticleStorePriceUpdateCandidateStatus.Archived, null)),
                _ when article is null => ValueTask.FromResult(
                    new ArticleStorePriceUpdateCandidate(ArticleStorePriceUpdateCandidateStatus.NotFound, null)),
                _ => ValueTask.FromResult(
                    new ArticleStorePriceUpdateCandidate(ArticleStorePriceUpdateCandidateStatus.Active, Clone(article)))
            };
        }

        public ValueTask<ArticleStoreUpdateStatus> UpdatePriceHtAsync(
            Article article,
            CancellationToken cancellationToken = default)
        {
            UpdateCalls++;
            UpdatedArticle = article;
            var existing = articles.SingleOrDefault(current => current.Ean13 == article.Ean13);
            if (existing is null)
            {
                return ValueTask.FromResult(ArticleStoreUpdateStatus.NotFound);
            }

            if (UpdateStatus != ArticleStoreUpdateStatus.Updated)
            {
                return ValueTask.FromResult(UpdateStatus);
            }

            existing.ChangePriceHt(article.PriceHt);
            return ValueTask.FromResult(ArticleStoreUpdateStatus.Updated);
        }

        private static Article Clone(Article article)
            => Assert.IsType<Article>(Article.Reconstitute(new ArticleDraft
            {
                Ean13 = article.Ean13.Value,
                Type = article.Type == ArticleType.Food ? "food" : "nonFood",
                Name = article.Name,
                PriceHtCents = article.PriceHt.Cents,
                Dlc = article.Dlc?.ToString("yyyy-MM-dd"),
                DlcProvided = article.Dlc is not null,
                ConsumptionModes = article.Type == ArticleType.Food
                    ? article.ConsumptionModes.Select(mode => mode == ConsumptionMode.Takeaway ? "takeaway" : "onsite").ToArray()
                    : null,
                ConsumptionModesProvided = article.Type == ArticleType.Food,
                Packaging = article.Packaging switch
                {
                    PackagingCondition.New => "new",
                    PackagingCondition.Refurbished => "refurbished",
                    PackagingCondition.Unsellable => "unsellable",
                    _ => null
                },
                PackagingProvided = article.Packaging is not null
            }, article.IsActive).Value);
    }
}
