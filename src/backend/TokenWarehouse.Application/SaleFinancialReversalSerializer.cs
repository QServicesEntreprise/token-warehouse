using System.Text.Json;
using System.Text.Json.Serialization;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Application;

public sealed record SaleFinancialReversalPayload(
    [property: JsonPropertyName("sourceOperationId")] string SourceOperationId,
    [property: JsonPropertyName("saleContext")] string? SaleContext,
    [property: JsonPropertyName("unitPriceHtCents")] int UnitPriceHtCents,
    [property: JsonPropertyName("taxRateCode")] string TaxRateCode,
    [property: JsonPropertyName("taxRateNumerator")] int TaxRateNumerator,
    [property: JsonPropertyName("taxRateDenominator")] int TaxRateDenominator,
    [property: JsonPropertyName("amountHtCents")] int AmountHtCents,
    [property: JsonPropertyName("vatCents")] int VatCents,
    [property: JsonPropertyName("amountTtcCents")] int AmountTtcCents);

public static class SaleFinancialReversalSerializer
{
    public const string Type = "sale.financial.reversal.v1";

    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        NumberHandling = JsonNumberHandling.Strict
    };

    public static string Serialize(SaleFinancialReversal reversal)
    {
        ArgumentNullException.ThrowIfNull(reversal);
        return JsonSerializer.Serialize(
            new SaleFinancialReversalPayload(
                reversal.SourceOperationId,
                reversal.SaleContext switch
                {
                    SaleContext.Takeaway => "takeaway",
                    SaleContext.OnSite => "onsite",
                    _ => null
                },
                reversal.UnitPriceHt.Cents,
                reversal.TaxRate.Code,
                reversal.TaxRate.Numerator,
                reversal.TaxRate.Denominator,
                reversal.AmountHt.Cents,
                reversal.Vat.Cents,
                reversal.AmountTtc.Cents),
            Options);
    }

    public static bool TryDeserialize(
        string? type,
        string? payload,
        out SaleFinancialReversal reversal)
    {
        reversal = default!;
        if (!string.Equals(type, Type, StringComparison.Ordinal)
            || string.IsNullOrWhiteSpace(payload))
        {
            return false;
        }

        try
        {
            var data = JsonSerializer.Deserialize<SaleFinancialReversalPayload>(payload, Options);
            if (data is null
                || string.IsNullOrWhiteSpace(data.SourceOperationId)
                || data.UnitPriceHtCents < 0
                || data.AmountHtCents > 0
                || data.VatCents > 0
                || data.AmountTtcCents > 0
                || (long)data.AmountTtcCents != (long)data.AmountHtCents + data.VatCents)
            {
                return false;
            }

            var context = data.SaleContext switch
            {
                "takeaway" => SaleContext.Takeaway,
                "onsite" => SaleContext.OnSite,
                null => (SaleContext?)null,
                _ => throw new ArgumentException("Invalid Sale context.")
            };
            var taxRate = new TaxRate(
                data.TaxRateCode,
                data.TaxRateNumerator,
                data.TaxRateDenominator);
            if (taxRate != ExpectedRate(context))
            {
                return false;
            }

            reversal = new(
                data.SourceOperationId,
                Money.FromCents(data.UnitPriceHtCents),
                context,
                taxRate,
                Money.FromCents(data.AmountHtCents),
                Money.FromCents(data.VatCents),
                Money.FromCents(data.AmountTtcCents));
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }

    private static TaxRate ExpectedRate(SaleContext? context)
        => context switch
        {
            SaleContext.Takeaway => TaxRate.Takeaway,
            SaleContext.OnSite => TaxRate.OnSite,
            _ => TaxRate.NonFood
        };
}
