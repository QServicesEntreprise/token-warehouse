using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Api;

public static class DashboardEndpoints
{
    public static void MapDashboardEndpoints(this WebApplication app)
    {
        app.MapGet("/api/dashboard", async (
            string? from,
            string? to,
            string? type,
            string? mode,
            string? packaging,
            IReadCurrentDashboardUseCase useCase,
            CancellationToken cancellationToken) =>
        {
            var result = await useCase.ReadAsync(
                new DashboardQueryRequest(from, to, type, mode, packaging),
                cancellationToken);
            return result.Status switch
            {
                DashboardReadStatus.Success => Results.Ok(DashboardResponse.From(result.View!)),
                DashboardReadStatus.ValidationFailed => ValidationProblem(result.Errors),
                _ => PersistenceProblem()
            };
        });
    }

    private static IResult PersistenceProblem()
        => Results.Problem(
            statusCode: StatusCodes.Status500InternalServerError,
            title: "Le Dashboard ne peut pas être chargé.",
            extensions: new Dictionary<string, object?>
            {
                ["code"] = "dashboard.persistence_failure"
            });

    private static IResult ValidationProblem(IReadOnlyList<ArticleValidationError> errors)
        => Results.Problem(
            statusCode: StatusCodes.Status400BadRequest,
            title: "La requête du Dashboard est invalide.",
            extensions: new Dictionary<string, object?>
            {
                ["code"] = errors.FirstOrDefault()?.Code ?? "dashboard.invalid_request",
                ["errors"] = errors
                    .GroupBy(error => error.Field, StringComparer.Ordinal)
                    .ToDictionary(
                        group => group.Key,
                        group => group.Select(error => error.Message).ToArray(),
                        StringComparer.Ordinal)
            });
}

public sealed class DashboardResponse
{
    public DashboardKpiResponse Kpis { get; init; } = new();

    public DashboardAlertsResponse Alerts { get; init; } = new();

    public IReadOnlyList<DashboardStockLineResponse> StockByArticle { get; init; } = [];

    public IReadOnlyList<DashboardFlowDayResponse> FlowsByDay { get; init; } = [];

    public DashboardFinancialResponse Financial { get; init; } = new();

    public static DashboardResponse From(CurrentDashboardView dashboard) => new()
    {
        Kpis = new()
        {
            PhysicalStock = dashboard.Kpis.PhysicalStock,
            SellableStock = dashboard.Kpis.SellableStock,
            NonSellableStock = dashboard.Kpis.NonSellableStock
        },
        Alerts = new()
        {
            OutOfStock = dashboard.Alerts.OutOfStock.Select(DashboardStockLineResponse.From).ToArray(),
            NotSellable = dashboard.Alerts.NotSellable.Select(DashboardStockLineResponse.From).ToArray()
        },
        StockByArticle = dashboard.StockByArticle.Select(DashboardStockLineResponse.From).ToArray(),
        FlowsByDay = dashboard.FlowsByDay.Select(DashboardFlowDayResponse.From).ToArray(),
        Financial = DashboardFinancialResponse.From(dashboard.Financial)
    };
}

public sealed class DashboardFinancialResponse
{
    public int RevenueHtCents { get; init; }

    public int RevenueTtcCents { get; init; }

    public int VatCollectedCents { get; init; }

    public IReadOnlyList<DashboardTaxRateSummaryResponse> ByTaxRate { get; init; } = [];

    public static DashboardFinancialResponse From(FinancialSummary financial) => new()
    {
        RevenueHtCents = financial.RevenueHt.Cents,
        RevenueTtcCents = financial.RevenueTtc.Cents,
        VatCollectedCents = financial.VatCollected.Cents,
        ByTaxRate = financial.ByTaxRate
            .Select(DashboardTaxRateSummaryResponse.From)
            .ToArray()
    };
}

public sealed class DashboardTaxRateSummaryResponse
{
    public TaxRateResponse TaxRate { get; init; } = new();

    public int AmountHtCents { get; init; }

    public int VatCents { get; init; }

    public int AmountTtcCents { get; init; }

    public static DashboardTaxRateSummaryResponse From(FinancialTaxRateSummary summary) => new()
    {
        TaxRate = TaxRateResponse.From(summary.TaxRate),
        AmountHtCents = summary.AmountHt.Cents,
        VatCents = summary.Vat.Cents,
        AmountTtcCents = summary.AmountTtc.Cents
    };
}

public sealed class DashboardFlowDayResponse
{
    public string Date { get; init; } = string.Empty;

    public int Supplies { get; init; }

    public int Sales { get; init; }

    public static DashboardFlowDayResponse From(DashboardFlowDayView day) => new()
    {
        Date = day.Date.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
        Supplies = day.Supplies,
        Sales = day.Sales
    };
}

public sealed class DashboardKpiResponse
{
    public int PhysicalStock { get; init; }

    public int SellableStock { get; init; }

    public int NonSellableStock { get; init; }
}

public sealed class DashboardAlertsResponse
{
    public IReadOnlyList<DashboardStockLineResponse> OutOfStock { get; init; } = [];

    public IReadOnlyList<DashboardStockLineResponse> NotSellable { get; init; } = [];
}

public sealed class DashboardStockLineResponse
{
    public string Ean13 { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    public string ArticleType { get; init; } = string.Empty;

    public string LifecycleStatus { get; init; } = string.Empty;

    public int PhysicalStock { get; init; }

    public int SellableStock { get; init; }

    public int NonSellableStock { get; init; }

    public string Availability { get; init; } = string.Empty;

    public string? Reason { get; init; }

    public static DashboardStockLineResponse From(DashboardStockLineView line) => new()
    {
        Ean13 = line.Ean13,
        Name = line.Name,
        ArticleType = line.ArticleType == TokenWarehouse.Domain.ArticleType.Food ? "food" : "nonFood",
        LifecycleStatus = line.LifecycleStatus == ArticleLifecycleStatus.Active ? "ACTIVE" : "ARCHIVED",
        PhysicalStock = line.PhysicalStock,
        SellableStock = line.SellableStock,
        NonSellableStock = line.NonSellableStock,
        Availability = StockPositionResponse.AvailabilityCode(line.Availability),
        Reason = StockPositionResponse.ReasonCode(line.Reason)
    };
}
