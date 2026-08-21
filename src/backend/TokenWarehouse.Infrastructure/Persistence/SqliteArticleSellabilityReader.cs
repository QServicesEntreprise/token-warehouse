using System.Globalization;
using Microsoft.EntityFrameworkCore;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteArticleSellabilityReader(
    IDbContextFactory<WarehouseDbContext> contextFactory) : IArticleSellabilityReader
{
    public async ValueTask<ArticleSellabilitySnapshot?> FindSellabilityByEanAsync(
        Ean13 ean13,
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        var entity = await context.Articles
            .AsNoTracking()
            .SingleOrDefaultAsync(article => article.Ean13 == ean13.Value, cancellationToken);

        return entity is null
            ? null
            : ToSnapshot(entity);
    }

    internal static ArticleSellabilitySnapshot ToSnapshot(ArticleEntity entity)
    {
        if (!Ean13.TryCreate(entity.Ean13, out var ean13)
            || !TryParseType(entity.Type, out var type)
            || !TryParseDate(entity.Dlc, out var dlc)
            || !TryParseModes(entity.ConsumptionModes, type, out var consumptionModes)
            || !TryParsePackaging(entity.Packaging, type, out var packaging))
        {
            throw new InvalidOperationException("Stored Article data is invalid.");
        }

        return new(
            ean13,
            entity.Name,
            type,
            entity.IsActive,
            dlc,
            consumptionModes,
            packaging,
            entity.Version);
    }

    private static bool TryParseType(string value, out ArticleType type)
    {
        type = value.Equals("food", StringComparison.OrdinalIgnoreCase)
            ? ArticleType.Food
            : ArticleType.NonFood;
        return value.Equals("food", StringComparison.OrdinalIgnoreCase)
            || value.Equals("nonFood", StringComparison.OrdinalIgnoreCase);
    }

    private static bool TryParseDate(string? value, out DateOnly? date)
    {
        date = null;
        if (value is null)
        {
            return true;
        }

        if (!DateOnly.TryParseExact(
                value,
                "yyyy-MM-dd",
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var parsed))
        {
            return false;
        }

        date = parsed;
        return true;
    }

    private static bool TryParseModes(
        string? value,
        ArticleType type,
        out IReadOnlyList<ConsumptionMode> modes)
    {
        modes = [];
        if (type == ArticleType.NonFood)
        {
            return value is null;
        }

        var parsed = new List<ConsumptionMode>();
        foreach (var mode in value?.Split(',', StringSplitOptions.RemoveEmptyEntries) ?? [])
        {
            if (mode.Equals("takeaway", StringComparison.OrdinalIgnoreCase))
            {
                parsed.Add(ConsumptionMode.Takeaway);
            }
            else if (mode.Equals("onsite", StringComparison.OrdinalIgnoreCase))
            {
                parsed.Add(ConsumptionMode.OnSite);
            }
            else
            {
                return false;
            }
        }

        modes = parsed;
        return true;
    }

    private static bool TryParsePackaging(
        string? value,
        ArticleType type,
        out PackagingCondition? packaging)
    {
        packaging = null;
        if (type == ArticleType.Food)
        {
            return value is null;
        }

        packaging = value switch
        {
            "new" => PackagingCondition.New,
            "refurbished" => PackagingCondition.Refurbished,
            "unsellable" => PackagingCondition.Unsellable,
            _ => null
        };
        return packaging is not null;
    }
}
