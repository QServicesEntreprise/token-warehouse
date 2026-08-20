using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteArticleStore(IDbContextFactory<WarehouseDbContext> contextFactory) : IArticleStore
{
    public async ValueTask<Article?> FindByEanAsync(
        Ean13 ean13,
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        var entity = await context.Articles
            .AsNoTracking()
            .SingleOrDefaultAsync(article => article.Ean13 == ean13.Value, cancellationToken);

        return entity is null ? null : ToDomain(entity);
    }

    public async ValueTask<ArticleStoreInsertStatus> InsertAsync(
        Article article,
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        context.Articles.Add(ToEntity(article));

        try
        {
            await context.SaveChangesAsync(cancellationToken);
            return ArticleStoreInsertStatus.Created;
        }
        catch (DbUpdateException exception) when (IsUniqueConstraintViolation(exception))
        {
            return ArticleStoreInsertStatus.Conflict;
        }
    }

    private static ArticleEntity ToEntity(Article article)
        => new()
        {
            Ean13 = article.Ean13.Value,
            Type = article.Type == ArticleType.Food ? "food" : "nonFood",
            Name = article.Name,
            PriceHtCents = article.PriceHt.Cents,
            IsActive = article.IsActive,
            Dlc = article.Dlc?.ToString("yyyy-MM-dd"),
            ConsumptionModes = article.Type == ArticleType.Food
                ? string.Join(',', article.ConsumptionModes.Select(ToWireMode))
                : null,
            Packaging = article.Packaging is null ? null : ToWirePackaging(article.Packaging.Value)
        };

    private static Article ToDomain(ArticleEntity entity)
    {
        var result = Article.Create(new ArticleDraft
        {
            Ean13 = entity.Ean13,
            Type = entity.Type,
            Name = entity.Name,
            PriceHtCents = entity.PriceHtCents,
            Dlc = entity.Dlc,
            DlcProvided = entity.Dlc is not null,
            ConsumptionModes = entity.ConsumptionModes?.Split(',', StringSplitOptions.RemoveEmptyEntries),
            ConsumptionModesProvided = entity.ConsumptionModes is not null,
            Packaging = entity.Packaging,
            PackagingProvided = entity.Packaging is not null
        });

        if (!result.IsSuccess || result.Value is null || !entity.IsActive)
        {
            throw new InvalidOperationException("Stored Article data is invalid.");
        }

        return result.Value;
    }

    private static bool IsUniqueConstraintViolation(DbUpdateException exception)
        => exception.InnerException is SqliteException { SqliteErrorCode: 19 };

    private static string ToWireMode(ConsumptionMode mode)
        => mode == ConsumptionMode.Takeaway ? "takeaway" : "onsite";

    private static string ToWirePackaging(PackagingCondition packaging)
        => packaging switch
        {
            PackagingCondition.New => "new",
            PackagingCondition.Refurbished => "refurbished",
            _ => "unsellable"
        };
}
