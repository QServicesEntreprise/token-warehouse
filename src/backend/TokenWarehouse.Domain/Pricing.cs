namespace TokenWarehouse.Domain;

public enum SaleContext
{
    Takeaway,
    OnSite
}

public readonly record struct TaxRate
{
    public TaxRate(string code, int numerator, int denominator)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            throw new ArgumentException("A TaxRate code is required.", nameof(code));
        }

        if (numerator <= 0 || denominator <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(numerator));
        }

        Code = code;
        Numerator = numerator;
        Denominator = denominator;
    }

    public string Code { get; }

    public int Numerator { get; }

    public int Denominator { get; }

    public static TaxRate Takeaway => new("takeaway", 11, 200);

    public static TaxRate OnSite => new("onsite", 1, 10);

    public static TaxRate NonFood => new("nonFood", 1, 5);

    public Money CalculateVat(Money priceHt)
        => Money.FromCents(checked((int)RoundAwayFromZero((long)priceHt.Cents * Numerator, Denominator)));

    private static long RoundAwayFromZero(long numerator, int denominator)
    {
        var sign = numerator < 0 ? -1 : 1;
        var absolute = Math.Abs(numerator);
        var quotient = absolute / denominator;
        var remainder = absolute % denominator;
        if (remainder * 2 >= denominator)
        {
            quotient++;
        }

        return sign * quotient;
    }
}

public sealed record PricingValidationError(string Code, string Field, string Message);

public sealed record PricingQuote(
    SaleContext? SaleContext,
    TaxRate TaxRate,
    Money Vat,
    Money PriceTtc);

public sealed record PricingResult(
    IReadOnlyList<PricingQuote> Quotes,
    IReadOnlyList<PricingValidationError> Errors)
{
    public bool IsSuccess => Errors.Count == 0;
}

public sealed record SaleFinancialSnapshot(
    SaleContext? SaleContext,
    Money UnitPriceHt,
    TaxRate TaxRate,
    Money AmountHt,
    Money Vat,
    Money AmountTtc);

public sealed record SalePricingResult(
    SaleFinancialSnapshot? Snapshot,
    IReadOnlyList<PricingValidationError> Errors)
{
    public bool IsSuccess => Snapshot is not null && Errors.Count == 0;
}

public static class PricingPolicy
{
    public static PricingResult Calculate(Article article)
    {
        ArgumentNullException.ThrowIfNull(article);

        if (article.Type == ArticleType.NonFood)
        {
            return new([CreateQuote(article.PriceHt, null, TaxRate.NonFood)], []);
        }

        return new(
            article.ConsumptionModes
                .Select(mode => CreateQuote(article.PriceHt, ToSaleContext(mode), TaxRateFor(mode)))
                .ToArray(),
            []);
    }

    public static PricingResult Resolve(Article article, SaleContext? saleContext = null)
    {
        ArgumentNullException.ThrowIfNull(article);

        var quotes = Calculate(article).Quotes;
        if (saleContext is null)
        {
            if (quotes.Count == 1)
            {
                return new(quotes, []);
            }

            return MissingContext();
        }

        if (article.Type == ArticleType.NonFood)
        {
            return ContextNotAllowed();
        }

        var quote = quotes.SingleOrDefault(candidate => candidate.SaleContext == saleContext);
        return quote is null
            ? IncompatibleContext()
            : new([quote], []);
    }

    public static SalePricingResult CalculateSale(
        Article article,
        Quantity quantity,
        SaleContext? saleContext = null)
    {
        ArgumentNullException.ThrowIfNull(article);
        if (quantity.Value <= 0)
        {
            return new(
                null,
                [new(
                    "pricing.quantity.invalid",
                    "quantity",
                    "La quantité doit être un entier strictement positif.")]);
        }

        try
        {
            var resolved = Resolve(article, saleContext);
            if (!resolved.IsSuccess)
            {
                return new(null, resolved.Errors);
            }

            var quote = resolved.Quotes.Single();
            var amountHt = Money.FromCents(checked((int)((long)article.PriceHt.Cents * quantity.Value)));
            var vat = quote.TaxRate.CalculateVat(amountHt);
            var amountTtc = Money.FromCents(checked(amountHt.Cents + vat.Cents));
            return new(
                new(
                    quote.SaleContext,
                    article.PriceHt,
                    quote.TaxRate,
                    amountHt,
                    vat,
                    amountTtc),
                []);
        }
        catch (OverflowException)
        {
            return new(
                null,
                [new(
                    "pricing.amount.overflow",
                    "quantity",
                    "Le montant de la Vente dépasse la capacité financière autorisée.")]);
        }
    }

    private static PricingQuote CreateQuote(Money priceHt, SaleContext? context, TaxRate taxRate)
    {
        var vat = taxRate.CalculateVat(priceHt);
        return new(context, taxRate, vat, Money.FromCents(checked(priceHt.Cents + vat.Cents)));
    }

    private static SaleContext ToSaleContext(ConsumptionMode mode)
        => mode == ConsumptionMode.Takeaway ? SaleContext.Takeaway : SaleContext.OnSite;

    private static TaxRate TaxRateFor(ConsumptionMode mode)
        => mode == ConsumptionMode.Takeaway ? TaxRate.Takeaway : TaxRate.OnSite;

    private static PricingResult MissingContext()
        => new(
            [],
            [new(
                "pricing.saleContext.required",
                "saleContext",
                "Le Contexte de Vente est requis lorsque les deux modes sont disponibles.")]);

    private static PricingResult IncompatibleContext()
        => new(
            [],
            [new(
                "pricing.saleContext.incompatible",
                "saleContext",
                "Le Contexte de Vente ne correspond pas aux modes disponibles pour cet Article.")]);

    private static PricingResult ContextNotAllowed()
        => new(
            [],
            [new(
                "pricing.saleContext.not_allowed",
                "saleContext",
                "Le Contexte de Vente ne s’applique pas à un Article non alimentaire.")]);
}
