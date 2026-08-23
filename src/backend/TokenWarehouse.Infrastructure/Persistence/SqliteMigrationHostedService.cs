using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using System.Globalization;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteMigrationHostedService(
    IDbContextFactory<WarehouseDbContext> contextFactory,
    IPersistenceAdapter persistence,
    IHostEnvironment environment,
    IClock clock) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        if (!string.Equals(persistence.Provider, "sqlite", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        await context.Database.MigrateAsync(cancellationToken);
        await BackfillNameSearchKeysAsync(context, cancellationToken);

        if (environment.IsEnvironment("Testing"))
        {
            var seed = Environment.GetEnvironmentVariable("TOKEN_WAREHOUSE_E2E_SEED");
            var flowSeed = string.Equals(seed, "flows", StringComparison.OrdinalIgnoreCase)
                || string.Equals(seed, "flows-boundary", StringComparison.OrdinalIgnoreCase);
            var financialSeed = string.Equals(seed, "financial", StringComparison.OrdinalIgnoreCase);
            if (string.Equals(seed, "true", StringComparison.OrdinalIgnoreCase)
                || flowSeed
                || financialSeed)
            {
                await SeedE2eStockArticlesAsync(context, clock.WarehouseDate, cancellationToken);
            }

            if (flowSeed)
            {
                await SeedE2eFlowFactsAsync(
                    context,
                    cancellationToken,
                    string.Equals(seed, "flows-boundary", StringComparison.OrdinalIgnoreCase));
            }

            if (financialSeed)
            {
                await SeedE2eFinancialFactsAsync(context, cancellationToken);
            }
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private static async Task BackfillNameSearchKeysAsync(
        WarehouseDbContext context,
        CancellationToken cancellationToken)
    {
        var articles = await context.Articles
            .Where(article => article.NameSearchKey == string.Empty)
            .ToListAsync(cancellationToken);

        if (articles.Count == 0)
        {
            return;
        }

        foreach (var article in articles)
        {
            article.NameSearchKey = ArticleNameSearchKey.From(article.Name);
        }

        await context.SaveChangesAsync(cancellationToken);
    }

    private static async Task SeedE2eStockArticlesAsync(
        WarehouseDbContext context,
        DateOnly today,
        CancellationToken cancellationToken)
    {
        var fixtureArticles = new[]
        {
            new ArticleEntity
            {
                Ean13 = "0123456789012",
                Type = "food",
                Name = "Alimentaire aux deux modes",
                NameSearchKey = ArticleNameSearchKey.From("Alimentaire aux deux modes"),
                PriceHtCents = 100,
                IsActive = true,
                Dlc = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                ConsumptionModes = "takeaway,onsite"
            },
            new ArticleEntity
            {
                Ean13 = "1234567890128",
                Type = "food",
                Name = "Alimentaire à DLC dépassée",
                NameSearchKey = ArticleNameSearchKey.From("Alimentaire à DLC dépassée"),
                PriceHtCents = 100,
                IsActive = true,
                Dlc = "2020-01-14",
                ConsumptionModes = "takeaway"
            },
            new ArticleEntity
            {
                Ean13 = "2345678901234",
                Type = "nonFood",
                Name = "Article archivé",
                NameSearchKey = ArticleNameSearchKey.From("Article archivé"),
                PriceHtCents = 100,
                IsActive = false,
                Packaging = "refurbished"
            },
            new ArticleEntity
            {
                Ean13 = "3456789012340",
                Type = "nonFood",
                Name = "Non alimentaire au Packaging Invendable",
                NameSearchKey = ArticleNameSearchKey.From("Non alimentaire au Packaging Invendable"),
                PriceHtCents = 100,
                IsActive = true,
                Packaging = "unsellable"
            },
            new ArticleEntity
            {
                Ean13 = "4567890123456",
                Type = "nonFood",
                Name = "Article actif vendable",
                NameSearchKey = ArticleNameSearchKey.From("Article actif vendable"),
                PriceHtCents = 100,
                IsActive = true,
                Packaging = "new"
            },
            new ArticleEntity
            {
                Ean13 = "5678901234562",
                Type = "food",
                Name = "Article actif sans position",
                NameSearchKey = ArticleNameSearchKey.From("Article actif sans position"),
                PriceHtCents = 100,
                IsActive = true,
                Dlc = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                ConsumptionModes = "onsite"
            }
        };

        foreach (var article in fixtureArticles)
        {
            if (!await context.Articles.AnyAsync(existing => existing.Ean13 == article.Ean13, cancellationToken))
            {
                context.Articles.Add(article);
            }
        }
        await context.SaveChangesAsync(cancellationToken);

        var physicalQuantities = new Dictionary<string, int>
        {
            ["0123456789012"] = 5,
            ["1234567890128"] = 7,
            ["2345678901234"] = 4,
            ["3456789012340"] = 3,
            ["4567890123456"] = 8
        };
        foreach (var (ean13, physicalQuantity) in physicalQuantities)
        {
            if (!await context.StockPositions.AnyAsync(position => position.Ean13 == ean13, cancellationToken))
            {
                context.StockPositions.Add(new StockPositionEntity
                {
                    Ean13 = ean13,
                    PhysicalQuantity = physicalQuantity
                });
            }
        }

        await context.SaveChangesAsync(cancellationToken);
    }

    private static async Task SeedE2eFlowFactsAsync(
        WarehouseDbContext context,
        CancellationToken cancellationToken,
        bool includeBoundary)
    {
        if (await context.StockOperations.AnyAsync(
                operation => operation.Id == "e2e-flow-bulk",
                cancellationToken))
        {
            return;
        }

        static StockOperationEntity Operation(
            string id,
            string type,
            string ean13,
            string timestamp,
            int quantity,
            string? sourceOperationId = null,
            string? sourceOperationType = null,
            string? justification = null,
            string? saleCommitDataPayload = null)
        {
            var operation = new StockOperationEntity
            {
                Id = id,
                Type = type,
                Ean13 = ean13,
                Quantity = quantity,
                OccurredAt = timestamp,
                TimestampUtc = timestamp,
                SourceOperationId = sourceOperationId,
                SourceOperationType = sourceOperationType,
                Justification = justification,
                SaleCommitDataType = saleCommitDataPayload is null
                    ? null
                    : SaleFinancialSnapshotSerializer.Type,
                SaleCommitDataPayload = saleCommitDataPayload
            };

            if (saleCommitDataPayload is not null
                && SaleFinancialSnapshotSerializer.TryDeserialize(
                    SaleFinancialSnapshotSerializer.Type,
                    saleCommitDataPayload,
                    out var financial))
            {
                operation.SaleFinancialContext = financial.SaleContext switch
                {
                    SaleContext.Takeaway => "takeaway",
                    SaleContext.OnSite => "onsite",
                    _ => null
                };
                operation.SaleFinancialUnitPriceHtCents = financial.UnitPriceHt.Cents;
                operation.SaleFinancialTaxRateCode = financial.TaxRate.Code;
                operation.SaleFinancialTaxRateNumerator = financial.TaxRate.Numerator;
                operation.SaleFinancialTaxRateDenominator = financial.TaxRate.Denominator;
                operation.SaleFinancialAmountHtCents = financial.AmountHt.Cents;
                operation.SaleFinancialVatCents = financial.Vat.Cents;
                operation.SaleFinancialAmountTtcCents = financial.AmountTtc.Cents;
            }

            return operation;
        }

        static StockOperationLineEntity Line(
            string operationId,
            int lineNumber,
            string ean13,
            string operationType,
            int quantity,
            int sourceEffect,
            int inverseEffect = 0,
            int previousPhysicalStock = 0,
            int countedQuantity = 0,
            int inventoryDifference = 0,
            int resultingPhysicalStock = 0)
            => new()
            {
                OperationId = operationId,
                LineNumber = lineNumber,
                Ean13 = ean13,
                OperationType = operationType,
                Quantity = quantity,
                SourceEffect = sourceEffect,
                InverseEffect = inverseEffect,
                PreviousPhysicalStock = previousPhysicalStock,
                CountedQuantity = countedQuantity,
                InventoryDifference = inventoryDifference,
                ResultingPhysicalStock = resultingPhysicalStock
            };

        var takeaway = SaleFinancialSnapshotSerializer.Serialize(
            new SaleFinancialSnapshot(
                SaleContext.Takeaway,
                Money.FromCents(100),
                TaxRate.Takeaway,
                Money.FromCents(200),
                Money.FromCents(11),
                Money.FromCents(211)));
        var takeawaySingle = SaleFinancialSnapshotSerializer.Serialize(
            new SaleFinancialSnapshot(
                SaleContext.Takeaway,
                Money.FromCents(100),
                TaxRate.Takeaway,
                Money.FromCents(100),
                Money.FromCents(6),
                Money.FromCents(106)));
        var onsite = SaleFinancialSnapshotSerializer.Serialize(
            new SaleFinancialSnapshot(
                SaleContext.OnSite,
                Money.FromCents(100),
                TaxRate.OnSite,
                Money.FromCents(400),
                Money.FromCents(40),
                Money.FromCents(440)));
        var bulkTimestamp = "2030-01-11T10:00:00+00:00";
        var nextTimestamp = "2030-01-12T10:00:00+00:00";
        context.StockOperations.AddRange(
            Operation("e2e-flow-bulk", "supply", "0123456789012", bulkTimestamp, 19),
            Operation("e2e-flow-supply", "supply", "0123456789012", nextTimestamp, 2),
            Operation("e2e-flow-sale-b", "SALE", "1234567890128", "2030-01-10T10:00:00+00:00", 2,
                saleCommitDataPayload: takeaway),
            Operation("e2e-flow-sale-takeaway", "SALE", "0123456789012", nextTimestamp, 1,
                saleCommitDataPayload: takeawaySingle),
            Operation("e2e-flow-sale-onsite", "SALE", "0123456789012", "2030-01-12T11:00:00+00:00", 4,
                saleCommitDataPayload: onsite),
            Operation("e2e-flow-after-gap", "supply", "0123456789012", "2030-01-14T10:00:00+00:00", 1),
            Operation("e2e-flow-inventory", "INVENTORY", "0123456789012", "2030-01-13T10:00:00+00:00", 0),
            Operation(
                "e2e-flow-counter",
                "COUNTER_MOVEMENT",
                "0123456789012",
                "2030-01-11T11:00:00+00:00",
                0,
                sourceOperationId: "e2e-flow-bulk",
                sourceOperationType: "SUPPLY",
                justification: "Test sans effet de flux"));
        if (includeBoundary)
        {
            context.StockOperations.AddRange(
                Operation(
                    "e2e-flow-boundary-before",
                    "supply",
                    "0123456789012",
                    "2030-01-10T21:59:59+00:00",
                    1),
                Operation(
                    "e2e-flow-boundary-at",
                    "supply",
                    "0123456789012",
                    "2030-01-10T22:00:00+00:00",
                    1));
        }
        context.StockOperationLines.AddRange(
            Line("e2e-flow-bulk", 1, "0123456789012", "supply", 5, 5),
            Line("e2e-flow-bulk", 2, "1234567890128", "supply", 3, 3),
            Line("e2e-flow-bulk", 3, "2345678901234", "supply", 7, 7),
            Line("e2e-flow-bulk", 4, "3456789012340", "supply", 4, 4),
            Line("e2e-flow-supply", 1, "0123456789012", "supply", 2, 2),
            Line("e2e-flow-sale-b", 1, "1234567890128", "SALE", 2, -2),
            Line("e2e-flow-sale-takeaway", 1, "0123456789012", "SALE", 1, -1),
            Line("e2e-flow-sale-onsite", 1, "0123456789012", "SALE", 4, -4),
            Line("e2e-flow-after-gap", 1, "0123456789012", "supply", 1, 1),
            Line("e2e-flow-inventory", 1, "0123456789012", "INVENTORY", 0, 99, 0, 0, 99, 99, 99),
            Line("e2e-flow-counter", 1, "0123456789012", "COUNTER_MOVEMENT", 0, 99, -99));
        if (includeBoundary)
        {
            context.StockOperationLines.AddRange(
                Line("e2e-flow-boundary-before", 1, "0123456789012", "supply", 1, 1),
                Line("e2e-flow-boundary-at", 1, "0123456789012", "supply", 1, 1));
        }
        await context.SaveChangesAsync(cancellationToken);
    }

    private static async Task SeedE2eFinancialFactsAsync(
        WarehouseDbContext context,
        CancellationToken cancellationToken)
    {
        if (await context.StockOperations.AnyAsync(
                operation => operation.Id == "e2e-financial-counter-onsite",
                cancellationToken))
        {
            return;
        }

        static StockOperationEntity Sale(
            string id,
            string ean13,
            string timestamp,
            SaleFinancialSnapshot snapshot)
        {
            var payload = SaleFinancialSnapshotSerializer.Serialize(snapshot);
            var operation = new StockOperationEntity
            {
                Id = id,
                Type = "SALE",
                Ean13 = ean13,
                Quantity = 1,
                OccurredAt = timestamp,
                TimestampUtc = timestamp,
                SaleCommitDataType = SaleFinancialSnapshotSerializer.Type,
                SaleCommitDataPayload = payload,
                SaleFinancialContext = snapshot.SaleContext switch
                {
                    SaleContext.Takeaway => "takeaway",
                    SaleContext.OnSite => "onsite",
                    _ => null
                },
                SaleFinancialUnitPriceHtCents = snapshot.UnitPriceHt.Cents,
                SaleFinancialTaxRateCode = snapshot.TaxRate.Code,
                SaleFinancialTaxRateNumerator = snapshot.TaxRate.Numerator,
                SaleFinancialTaxRateDenominator = snapshot.TaxRate.Denominator,
                SaleFinancialAmountHtCents = snapshot.AmountHt.Cents,
                SaleFinancialVatCents = snapshot.Vat.Cents,
                SaleFinancialAmountTtcCents = snapshot.AmountTtc.Cents
            };
            operation.Lines.Add(new StockOperationLineEntity
            {
                OperationId = id,
                LineNumber = 1,
                Ean13 = ean13,
                OperationType = "SALE",
                Quantity = 1,
                SourceEffect = -1
            });
            return operation;
        }

        static StockOperationEntity CounterMovement(
            string id,
            string ean13,
            string timestamp,
            string sourceOperationId,
            SaleFinancialSnapshot sourceSnapshot)
        {
            var reversal = SaleFinancialReversalPolicy.Create(sourceOperationId, sourceSnapshot);
            var operation = new StockOperationEntity
            {
                Id = id,
                Type = "COUNTER_MOVEMENT",
                Ean13 = ean13,
                Quantity = 0,
                OccurredAt = timestamp,
                TimestampUtc = timestamp,
                SourceOperationId = sourceOperationId,
                SourceOperationType = "SALE",
                Justification = "Correction financière E2E",
                SaleCommitDataType = SaleFinancialReversalSerializer.Type,
                SaleCommitDataPayload = SaleFinancialReversalSerializer.Serialize(reversal)
            };
            operation.Lines.Add(new StockOperationLineEntity
            {
                OperationId = id,
                LineNumber = 1,
                Ean13 = ean13,
                OperationType = "COUNTER_MOVEMENT",
                Quantity = 0,
                SourceEffect = -1,
                InverseEffect = 1
            });
            return operation;
        }

        var takeaway = new SaleFinancialSnapshot(
            SaleContext.Takeaway,
            Money.FromCents(1000),
            TaxRate.Takeaway,
            Money.FromCents(1000),
            Money.FromCents(55),
            Money.FromCents(1055));
        var onsite = new SaleFinancialSnapshot(
            SaleContext.OnSite,
            Money.FromCents(1000),
            TaxRate.OnSite,
            Money.FromCents(1000),
            Money.FromCents(100),
            Money.FromCents(1100));
        var nonFood = new SaleFinancialSnapshot(
            null,
            Money.FromCents(1000),
            TaxRate.NonFood,
            Money.FromCents(1000),
            Money.FromCents(200),
            Money.FromCents(1200));

        context.StockOperations.AddRange(
            Sale(
                "e2e-financial-sale-takeaway",
                "0123456789012",
                "2030-01-10T10:00:00+00:00",
                takeaway),
            Sale(
                "e2e-financial-sale-onsite",
                "1234567890128",
                "2030-01-10T11:00:00+00:00",
                onsite),
            Sale(
                "e2e-financial-sale-non-food",
                "2345678901234",
                "2030-01-10T12:00:00+00:00",
                nonFood),
            CounterMovement(
                "e2e-financial-counter-onsite",
                "1234567890128",
                "2030-01-20T10:00:00+00:00",
                "e2e-financial-sale-onsite",
                onsite));

        await context.SaveChangesAsync(cancellationToken);
    }
}
