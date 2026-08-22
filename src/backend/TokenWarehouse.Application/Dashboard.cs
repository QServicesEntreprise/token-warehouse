using System.Globalization;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Application;

public sealed record WarehouseDateRange(DateOnly From, DateOnly To);

public sealed record DashboardQueryRequest(
    string? From,
    string? To,
    string? Type,
    string? Mode,
    string? Packaging);

public sealed record DashboardArticleSelection(
    ArticleType? Type,
    ConsumptionMode? Mode,
    PackagingCondition? Packaging)
{
    public bool Matches(StockPositionView position)
        => MatchesArticle(position)
            && (Mode is null
                || (position.Type == ArticleType.Food && position.ConsumptionModes.Contains(Mode.Value)));

    public bool MatchesFlow(
        StockPositionView position,
        StockOperationType operationType,
        SaleContext? saleContext)
    {
        if (!MatchesArticle(position) || Mode is null)
        {
            return MatchesArticle(position);
        }

        return operationType == StockOperationType.Sale
            ? position.Type == ArticleType.Food
                && saleContext == (Mode == ConsumptionMode.Takeaway
                    ? SaleContext.Takeaway
                    : SaleContext.OnSite)
            : position.Type == ArticleType.Food && position.ConsumptionModes.Contains(Mode.Value);
    }

    public DashboardArticleSelection ForFlowCandidates()
        => this with
        {
            Type = Type
                ?? (Mode is not null ? ArticleType.Food
                    : Packaging is not null ? ArticleType.NonFood : null),
            Mode = null
        };

    private bool MatchesArticle(StockPositionView position)
        => (Type is null || position.Type == Type)
            && (Packaging is null
                || (position.Type == ArticleType.NonFood && position.Packaging == Packaging.Value));
}

public sealed record DashboardQuery(
    WarehouseDateRange Period,
    DashboardArticleSelection Selection);

public sealed record WarehouseDateRangeValidationResult(
    WarehouseDateRange? Range,
    IReadOnlyList<ArticleValidationError> Errors)
{
    public bool IsSuccess => Range is not null && Errors.Count == 0;
}

public interface IWarehouseCalendar
{
    DateOnly WarehouseDate { get; }

    WarehouseDateRange CurrentMonth { get; }

    WarehouseDateRangeValidationResult ValidatePeriod(string? from, string? to);

    DateOnly ToWarehouseDate(DateTimeOffset instant);
}

public sealed class WarehouseCalendar(
    IClock clock,
    TimeZoneInfo warehouseTimeZone) : IWarehouseCalendar
{
    private readonly TimeZoneInfo warehouseTimeZone = warehouseTimeZone;

    public DateOnly WarehouseDate => ToWarehouseDate(clock.UtcNow);

    public WarehouseDateRange CurrentMonth
    {
        get
        {
            var first = new DateOnly(WarehouseDate.Year, WarehouseDate.Month, 1);
            return new(first, first.AddMonths(1).AddDays(-1));
        }
    }

    public WarehouseDateRangeValidationResult ValidatePeriod(string? from, string? to)
    {
        var errors = new List<ArticleValidationError>();
        var parsedFrom = ParseDate(from, "from", "La borne de début de période est requise.", errors);
        var parsedTo = ParseDate(to, "to", "La borne de fin de période est requise.", errors);

        if (parsedFrom is { } fromDate && parsedTo is { } toDate && fromDate > toDate)
        {
            errors.Add(new(
                "dashboard.reversed_period",
                "from",
                "La date de début doit être antérieure ou égale à la date de fin."));
            errors.Add(new(
                "dashboard.reversed_period",
                "to",
                "La date de fin doit être postérieure ou égale à la date de début."));
        }

        return errors.Count > 0
            ? new(null, errors)
            : new(new(parsedFrom!.Value, parsedTo!.Value), []);
    }

    public DateOnly ToWarehouseDate(DateTimeOffset instant)
        => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, warehouseTimeZone).DateTime);

    private static DateOnly? ParseDate(
        string? value,
        string field,
        string missingMessage,
        ICollection<ArticleValidationError> errors)
    {
        if (value is null)
        {
            errors.Add(new("dashboard.missing_period", field, missingMessage));
            return null;
        }

        return DateOnly.TryParseExact(
            value,
            "yyyy-MM-dd",
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out var date)
            ? date
            : AddInvalidDateError(field, errors);
    }

    private static DateOnly? AddInvalidDateError(
        string field,
        ICollection<ArticleValidationError> errors)
    {
        errors.Add(new(
            "dashboard.invalid_date",
            field,
            "La date doit être une date calendrier au format YYYY-MM-DD."));
        return null;
    }
}

public sealed record DashboardKpiView(
    int PhysicalStock,
    int SellableStock,
    int NonSellableStock);

public sealed record DashboardStockLineView(
    string Ean13,
    string Name,
    ArticleType ArticleType,
    ArticleLifecycleStatus LifecycleStatus,
    int PhysicalStock,
    int SellableStock,
    int NonSellableStock,
    StockAvailability Availability,
    SellabilityReason? Reason);

public sealed record DashboardAlertsView(
    IReadOnlyList<DashboardStockLineView> OutOfStock,
    IReadOnlyList<DashboardStockLineView> NotSellable);

public sealed record CurrentDashboardView(
    DashboardKpiView Kpis,
    DashboardAlertsView Alerts,
    IReadOnlyList<DashboardStockLineView> StockByArticle,
    IReadOnlyList<DashboardFlowDayView> FlowsByDay);

public sealed record DashboardFlowDayView(
    DateOnly Date,
    int Supplies,
    int Sales);

public sealed record DashboardReadSnapshot(
    IReadOnlyList<StockPositionView> Positions,
    IReadOnlyList<StockOperationReadView> Operations);

public enum DashboardReadStatus
{
    Success,
    ValidationFailed,
    PersistenceFailed
}

public sealed record DashboardReadResult(
    DashboardReadStatus Status,
    CurrentDashboardView? View,
    IReadOnlyList<ArticleValidationError> Errors);

public interface IReadCurrentDashboardUseCase
{
    Task<DashboardReadResult> ReadAsync(
        DashboardQueryRequest request,
        CancellationToken cancellationToken = default);
}

public interface ICurrentDashboardReadSource
{
    Task<DashboardReadSnapshot> ReadAsync(
        DashboardQuery query,
        CancellationToken cancellationToken = default);
}

public sealed class DashboardApplication(
    ICurrentDashboardReadSource readSource,
    IWarehouseCalendar calendar)
    : IReadCurrentDashboardUseCase
{
    private readonly IWarehouseCalendar warehouseCalendar = calendar;

    public async Task<DashboardReadResult> ReadAsync(
        DashboardQueryRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var errors = new List<ArticleValidationError>();
        var period = warehouseCalendar.ValidatePeriod(request.From, request.To);
        errors.AddRange(period.Errors);
        var selection = ParseSelection(request, errors);
        if (errors.Count > 0)
        {
            return new(DashboardReadStatus.ValidationFailed, null, errors);
        }

        var query = new DashboardQuery(period.Range!, selection);

        try
        {
            var snapshot = await readSource.ReadAsync(query, cancellationToken);
            var rows = snapshot.Positions
                .Where(query.Selection.Matches)
                .OrderBy(position => position.Ean13.Value, StringComparer.Ordinal)
                .Select(ToLine)
                .ToArray();

            if (rows.GroupBy(row => row.Ean13, StringComparer.Ordinal).Any(group => group.Count() > 1))
            {
                return Failure();
            }

            var physicalStock = rows.Sum(row => row.PhysicalStock);
            var sellableStock = rows.Sum(row => row.SellableStock);
            var view = new CurrentDashboardView(
                new DashboardKpiView(
                    physicalStock,
                    sellableStock,
                    physicalStock - sellableStock),
                new DashboardAlertsView(
                    rows
                        .Where(row => row.Availability == StockAvailability.OutOfStock
                            && row.LifecycleStatus == ArticleLifecycleStatus.Active
                            && row.PhysicalStock == 0
                            && row.SellableStock == 0)
                        .ToArray(),
                    rows
                        .Where(row => row.Availability == StockAvailability.NotSellable
                            && row.PhysicalStock > 0
                            && row.SellableStock == 0)
                        .ToArray()),
                rows,
                AggregateFlowsByDay(query, snapshot.Positions, snapshot.Operations));

            return new(DashboardReadStatus.Success, view, []);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return Failure();
        }
    }

    private static DashboardStockLineView ToLine(StockPositionView position)
    {
        if (position.PhysicalQuantity < 0
            || position.SellableQuantity < 0
            || position.SellableQuantity > position.PhysicalQuantity
            || (position.PhysicalQuantity == 0 && position.Reason is not null)
            || (position.PhysicalQuantity > 0
                && position.SellableQuantity == 0
                && position.Reason is null)
            || (position.SellableQuantity > 0 && position.Reason is not null)
            || (position.PhysicalQuantity == 0
                && position.Availability != StockAvailability.OutOfStock)
            || (position.SellableQuantity > 0
                && position.Availability != StockAvailability.Available)
            || (position.PhysicalQuantity > 0
                && position.SellableQuantity == 0
                && position.Availability != StockAvailability.NotSellable))
        {
            throw new InvalidOperationException("The Stock read contract returned incompatible quantities.");
        }

        return new(
            position.Ean13.Value,
            position.Name,
            position.Type,
            position.IsActive ? ArticleLifecycleStatus.Active : ArticleLifecycleStatus.Archived,
            position.PhysicalQuantity,
            position.SellableQuantity,
            position.PhysicalQuantity - position.SellableQuantity,
            position.Availability,
            position.Reason);
    }

    private static DashboardReadResult Failure()
        => new(DashboardReadStatus.PersistenceFailed, null, []);

    private IReadOnlyList<DashboardFlowDayView> AggregateFlowsByDay(
        DashboardQuery query,
        IReadOnlyList<StockPositionView> positions,
        IReadOnlyList<StockOperationReadView> operations)
    {
        var days = new Dictionary<DateOnly, (int Supplies, int Sales)>();
        for (var date = query.Period.From; ; date = date.AddDays(1))
        {
            days.Add(date, (0, 0));
            if (date == query.Period.To)
            {
                break;
            }
        }

        var articles = positions
            .GroupBy(position => position.Ean13.Value, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Single(), StringComparer.Ordinal);

        foreach (var operation in operations)
        {
            if (operation.Type is not (StockOperationType.Supply or StockOperationType.Sale))
            {
                continue;
            }

            var date = warehouseCalendar.ToWarehouseDate(operation.TimestampUtc);
            if (!days.ContainsKey(date))
            {
                continue;
            }

            foreach (var line in operation.Lines.OrderBy(line => line.LineNumber))
            {
                if (line.Quantity < 0
                    || !articles.TryGetValue(line.Ean13, out var article)
                    || !query.Selection.MatchesFlow(article, operation.Type, operation.SaleContext))
                {
                    continue;
                }

                var bucket = days[date];
                days[date] = operation.Type == StockOperationType.Supply
                    ? (checked(bucket.Supplies + line.Quantity), bucket.Sales)
                    : (bucket.Supplies, checked(bucket.Sales + line.Quantity));
            }
        }

        return days
            .OrderBy(day => day.Key)
            .Select(day => new DashboardFlowDayView(day.Key, day.Value.Supplies, day.Value.Sales))
            .ToArray();
    }

    private static DashboardArticleSelection ParseSelection(
        DashboardQueryRequest request,
        ICollection<ArticleValidationError> errors)
        => new(
            ParseFilter<ArticleType>(
                request.Type,
                Article.TryParseArticleType,
                "type",
                "Le type de filtre est inconnu.",
                errors),
            ParseFilter<ConsumptionMode>(
                request.Mode,
                Article.TryParseConsumptionMode,
                "mode",
                "Le mode de consommation est inconnu.",
                errors),
            ParseFilter<PackagingCondition>(
                request.Packaging,
                Article.TryParsePackaging,
                "packaging",
                "La valeur de Packaging est inconnue.",
                errors));

    private static T? ParseFilter<T>(
        string? value,
        TryParseFilter<T> parser,
        string field,
        string message,
        ICollection<ArticleValidationError> errors)
        where T : struct
    {
        if (value is null
            || value.Equals("all", StringComparison.OrdinalIgnoreCase)
            || value.Equals("tous", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        if (parser(value, out var parsed))
        {
            return parsed;
        }

        errors.Add(new("dashboard.unsupported_filter", field, message));
        return null;
    }

    private delegate bool TryParseFilter<T>(string value, out T parsed)
        where T : struct;
}
