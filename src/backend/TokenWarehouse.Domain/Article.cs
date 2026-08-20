using System.Globalization;

namespace TokenWarehouse.Domain;

public enum ArticleType
{
    Food,
    NonFood
}

public enum ConsumptionMode
{
    Takeaway,
    OnSite
}

public enum PackagingCondition
{
    New,
    Refurbished,
    Unsellable
}

public sealed record ArticleValidationError(string Code, string Field, string Message);

public sealed record ArticleDraft
{
    public string? Ean13 { get; init; }
    public string? Type { get; init; }
    public string? Name { get; init; }
    public int? PriceHtCents { get; init; }
    public string? Dlc { get; init; }
    public bool DlcProvided { get; init; }
    public IReadOnlyList<string>? ConsumptionModes { get; init; }
    public bool ConsumptionModesProvided { get; init; }
    public string? Packaging { get; init; }
    public bool PackagingProvided { get; init; }
    public IReadOnlyList<string> UnsupportedFields { get; init; } = [];
}

public readonly record struct Ean13
{
    private Ean13(string value) => Value = value;

    public string Value { get; }

    public static bool TryCreate(string? value, out Ean13 ean13)
    {
        ean13 = default;
        if (value is null || value.Length != 13 || value.Any(character => character is < '0' or > '9'))
        {
            return false;
        }

        var sum = 0;
        for (var index = 0; index < 12; index++)
        {
            var digit = value[index] - '0';
            sum += index % 2 == 0 ? digit : digit * 3;
        }

        var checkDigit = (10 - sum % 10) % 10;
        if (checkDigit != value[12] - '0')
        {
            return false;
        }

        ean13 = new Ean13(value);
        return true;
    }
}

public readonly record struct Money(int Cents)
{
    public static Money FromCents(int cents) => new(cents);
}

public sealed record ArticleCreationResult(Article? Value, IReadOnlyList<ArticleValidationError> Errors)
{
    public bool IsSuccess => Value is not null && Errors.Count == 0;
}

public sealed class Article
{
    private Article(
        Ean13 ean13,
        ArticleType type,
        string name,
        Money priceHt,
        DateOnly? dlc,
        IReadOnlyList<ConsumptionMode> consumptionModes,
        PackagingCondition? packaging)
    {
        Ean13 = ean13;
        Type = type;
        Name = name;
        PriceHt = priceHt;
        Dlc = dlc;
        ConsumptionModes = consumptionModes.ToArray();
        Packaging = packaging;
        IsActive = true;
    }

    public Ean13 Ean13 { get; }

    public ArticleType Type { get; }

    public string Name { get; }

    public Money PriceHt { get; }

    public bool IsActive { get; }

    public DateOnly? Dlc { get; }

    public IReadOnlyList<ConsumptionMode> ConsumptionModes { get; }

    public PackagingCondition? Packaging { get; }

    public static ArticleCreationResult Create(ArticleDraft draft)
    {
        ArgumentNullException.ThrowIfNull(draft);

        var errors = new List<ArticleValidationError>();
        foreach (var field in draft.UnsupportedFields.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            errors.Add(new(
                "article.field.unsupported",
                field,
                $"Le champ « {field} » n’est pas accepté pour la création d’un Article."));
        }

        if (!Ean13.TryCreate(draft.Ean13, out var ean13))
        {
            errors.Add(new(
                "article.ean13.invalid",
                "ean13",
                "L’EAN-13 doit contenir 13 chiffres et un checksum valide."));
        }

        var hasType = TryParseArticleType(draft.Type, out var type);
        if (!hasType)
        {
            errors.Add(new(
                draft.Type is null ? "article.type.required" : "article.type.invalid",
                "type",
                draft.Type is null ? "Le type de l’Article est requis." : "Le type de l’Article est inconnu."));
        }

        if (string.IsNullOrWhiteSpace(draft.Name))
        {
            errors.Add(new("article.name.required", "name", "Le nom de l’Article est requis."));
        }

        if (draft.PriceHtCents is null)
        {
            errors.Add(new(
                "article.priceHtCents.required",
                "priceHtCents",
                "Le Prix HT en centimes est requis."));
        }

        DateOnly? dlc = null;
        var modes = new List<ConsumptionMode>();
        PackagingCondition? packaging = null;

        if (hasType && type == ArticleType.Food)
        {
            if (draft.PackagingProvided || draft.Packaging is not null)
            {
                errors.Add(new(
                    "article.packaging.not_applicable",
                    "packaging",
                    "Le Packaging ne s’applique pas à un Article alimentaire."));
            }

            if (!draft.DlcProvided || string.IsNullOrWhiteSpace(draft.Dlc))
            {
                errors.Add(new("article.dlc.required", "dlc", "La DLC est requise pour un Article alimentaire."));
            }
            else if (!DateOnly.TryParseExact(
                         draft.Dlc,
                         "yyyy-MM-dd",
                         CultureInfo.InvariantCulture,
                         DateTimeStyles.None,
                         out var parsedDlc))
            {
                errors.Add(new(
                    "article.dlc.invalid",
                    "dlc",
                    "La DLC doit être une date calendrier valide au format YYYY-MM-DD."));
            }
            else
            {
                dlc = parsedDlc;
            }

            if (!draft.ConsumptionModesProvided || draft.ConsumptionModes is null || draft.ConsumptionModes.Count == 0)
            {
                errors.Add(new(
                    "article.consumptionModes.required",
                    "consumptionModes",
                    "Au moins un mode de consommation est requis pour un Article alimentaire."));
            }
            else
            {
                foreach (var rawMode in draft.ConsumptionModes)
                {
                    if (!TryParseConsumptionMode(rawMode, out var mode))
                    {
                        errors.Add(new(
                            "article.consumptionModes.invalid",
                            "consumptionModes",
                            "Le mode de consommation est inconnu."));
                        continue;
                    }

                    if (!modes.Contains(mode))
                    {
                        modes.Add(mode);
                    }
                    else
                    {
                        errors.Add(new(
                            "article.consumptionModes.duplicate",
                            "consumptionModes",
                            "Un mode de consommation ne peut pas être répété."));
                    }
                }

                modes.Sort();
            }
        }
        else if (hasType && type == ArticleType.NonFood)
        {
            if (draft.DlcProvided || draft.Dlc is not null)
            {
                errors.Add(new(
                    "article.dlc.not_applicable",
                    "dlc",
                    "La DLC ne s’applique pas à un Article non alimentaire."));
            }

            if (draft.ConsumptionModesProvided || draft.ConsumptionModes is not null)
            {
                errors.Add(new(
                    "article.consumptionModes.not_applicable",
                    "consumptionModes",
                    "Les modes de consommation ne s’appliquent pas à un Article non alimentaire."));
            }

            if (!draft.PackagingProvided || string.IsNullOrWhiteSpace(draft.Packaging))
            {
                errors.Add(new("article.packaging.required", "packaging", "Le Packaging est requis pour un Article non alimentaire."));
            }
            else if (!TryParsePackaging(draft.Packaging, out var parsedPackaging))
            {
                errors.Add(new("article.packaging.invalid", "packaging", "La valeur de Packaging est inconnue."));
            }
            else
            {
                packaging = parsedPackaging;
            }
        }

        if (errors.Count > 0)
        {
            return new ArticleCreationResult(null, errors);
        }

        return new ArticleCreationResult(
            new Article(
                ean13,
                type,
                draft.Name!,
                Money.FromCents(draft.PriceHtCents!.Value),
                dlc,
                modes,
                packaging),
            []);
    }

    public static bool TryParseArticleType(string? value, out ArticleType type)
    {
        type = default;
        if (value is null)
        {
            return false;
        }

        if (value.Equals("food", StringComparison.OrdinalIgnoreCase))
        {
            type = ArticleType.Food;
            return true;
        }

        if (value.Equals("nonFood", StringComparison.OrdinalIgnoreCase))
        {
            type = ArticleType.NonFood;
            return true;
        }

        return false;
    }

    public static bool TryParseConsumptionMode(string? value, out ConsumptionMode mode)
    {
        mode = default;
        if (value is null)
        {
            return false;
        }

        if (value.Equals("takeaway", StringComparison.OrdinalIgnoreCase))
        {
            mode = ConsumptionMode.Takeaway;
            return true;
        }

        if (value.Equals("onsite", StringComparison.OrdinalIgnoreCase))
        {
            mode = ConsumptionMode.OnSite;
            return true;
        }

        return false;
    }

    public static bool TryParsePackaging(string? value, out PackagingCondition packaging)
    {
        packaging = default;
        if (value is null)
        {
            return false;
        }

        if (value.Equals("new", StringComparison.OrdinalIgnoreCase))
        {
            packaging = PackagingCondition.New;
            return true;
        }

        if (value.Equals("refurbished", StringComparison.OrdinalIgnoreCase))
        {
            packaging = PackagingCondition.Refurbished;
            return true;
        }

        if (value.Equals("unsellable", StringComparison.OrdinalIgnoreCase))
        {
            packaging = PackagingCondition.Unsellable;
            return true;
        }

        return false;
    }
}
