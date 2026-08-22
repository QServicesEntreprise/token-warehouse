using System.Globalization;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Api;

public sealed record DashboardQueryParseResult(
    DashboardQuery? Query,
    string? ErrorCode,
    IReadOnlyList<ArticleValidationError> Errors)
{
    public bool IsSuccess => Query is not null && Errors.Count == 0;
}

public static class DashboardQueryParser
{
    public static DashboardQueryParseResult Parse(
        string? from,
        string? to,
        string? type,
        string? mode,
        string? packaging)
    {
        var errors = new List<ArticleValidationError>();
        DateOnly? parsedFrom = ParseDate(from, "from", "La borne de début de période est requise.", errors);
        DateOnly? parsedTo = ParseDate(to, "to", "La borne de fin de période est requise.", errors);

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

        ArticleType? parsedType = ParseFilter<ArticleType>(
            type,
            Article.TryParseArticleType,
            "type",
            "Le type de filtre est inconnu.",
            errors);
        ConsumptionMode? parsedMode = ParseFilter<ConsumptionMode>(
            mode,
            Article.TryParseConsumptionMode,
            "mode",
            "Le mode de consommation est inconnu.",
            errors);
        PackagingCondition? parsedPackaging = ParseFilter<PackagingCondition>(
            packaging,
            Article.TryParsePackaging,
            "packaging",
            "La valeur de Packaging est inconnue.",
            errors);

        return errors.Count > 0
            ? new(null, errors[0].Code, errors)
            : new(
                new DashboardQuery(
                    new(parsedFrom!.Value, parsedTo!.Value),
                    new(parsedType, parsedMode, parsedPackaging)),
                null,
                []);
    }

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

    private static T? ParseFilter<T>(
        string? value,
        TryParseFilter<T> parser,
        string field,
        string message,
        ICollection<ArticleValidationError> errors)
        where T : struct
    {
        if (value is null || IsAll(value))
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

    private static bool IsAll(string value)
        => value.Equals("all", StringComparison.OrdinalIgnoreCase)
            || value.Equals("tous", StringComparison.OrdinalIgnoreCase);

    private delegate bool TryParseFilter<T>(string value, out T parsed)
        where T : struct;
}
