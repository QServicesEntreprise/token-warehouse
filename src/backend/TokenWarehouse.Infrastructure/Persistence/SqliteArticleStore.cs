using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteArticleStore(IDbContextFactory<WarehouseDbContext> contextFactory) : IArticleStore, IArticleSellabilityReader
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

    public async ValueTask<ArticleSellabilitySnapshot?> FindAsync(
        Ean13 ean13,
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        var entity = await context.Articles
            .AsNoTracking()
            .SingleOrDefaultAsync(article => article.Ean13 == ean13.Value, cancellationToken);

        return entity is null
            ? null
            : ArticleSellabilitySnapshot.From(ToDomain(entity));
    }

    public async ValueTask<IReadOnlyList<Article>> ListAsync(
        ArticleListFilter filter,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(filter);

        if (filter.Mode is not null && filter.Packaging is not null)
        {
            return [];
        }

        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        var query = context.Articles.AsNoTracking().AsQueryable();

        query = filter.Status switch
        {
            ArticleLifecycleFilter.Active => query.Where(article => article.IsActive),
            ArticleLifecycleFilter.Archived => query.Where(article => !article.IsActive),
            _ => query
        };

        if (filter.Type is not null)
        {
            query = query.Where(article => article.Type == ToWireType(filter.Type.Value));
        }

        if (filter.Search is not null)
        {
            var search = ArticleNameSearchKey.From(filter.Search);
            query = query.Where(article =>
                article.Ean13 == filter.Search
                || article.NameSearchKey.Contains(search));
        }

        if (filter.Mode is not null)
        {
            var mode = ToWireMode(filter.Mode.Value);
            query = query.Where(article =>
                article.Type == "food"
                && article.ConsumptionModes != null
                && article.ConsumptionModes.Contains(mode));
        }

        if (filter.Packaging is not null)
        {
            query = query.Where(article =>
                article.Type == "nonFood"
                && article.Packaging == ToWirePackaging(filter.Packaging.Value));
        }

        var entities = await query
            .OrderBy(article => article.Name)
            .ThenBy(article => article.Ean13)
            .ToListAsync(cancellationToken);

        return entities.Select(ToDomain).ToArray();
    }

    public async ValueTask<ArticleStoreLifecycleTransitionStatus> TransitionLifecycleAsync(
        Ean13 ean13,
        ArticleLifecycleStatus expectedStatus,
        ArticleLifecycleStatus targetStatus,
        ArticleLifecycleHistory history,
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        try
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var entity = await context.Articles
                .SingleOrDefaultAsync(
                    article => article.Ean13 == ean13.Value && article.IsActive == ToIsActive(expectedStatus),
                    cancellationToken);

            if (entity is null)
            {
                var exists = await context.Articles.AnyAsync(article => article.Ean13 == ean13.Value, cancellationToken);
                return exists
                    ? ArticleStoreLifecycleTransitionStatus.Conflict
                    : ArticleStoreLifecycleTransitionStatus.NotFound;
            }

            entity.IsActive = ToIsActive(targetStatus);
            entity.Version++;
            context.ArticleLifecycleHistory.Add(ToEntity(history));

            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return ArticleStoreLifecycleTransitionStatus.Updated;
        }
        catch (DbUpdateConcurrencyException)
        {
            return ArticleStoreLifecycleTransitionStatus.Conflict;
        }
        catch (DbUpdateException exception) when (IsSqliteLock(exception))
        {
            return ArticleStoreLifecycleTransitionStatus.Conflict;
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode is 5 or 6)
        {
            return ArticleStoreLifecycleTransitionStatus.Conflict;
        }
    }

    public async ValueTask<IReadOnlyList<ArticleLifecycleHistory>> ListLifecycleHistoryAsync(
        Ean13? ean13 = null,
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        var query = context.ArticleLifecycleHistory
            .AsNoTracking()
            .Where(history => history.Kind == "lifecycle");
        if (ean13 is { } value)
        {
            query = query.Where(history => history.Ean13 == value.Value);
        }

        var entities = await query
            .OrderBy(history => history.Id)
            .ToListAsync(cancellationToken);
        return entities
            .Select(ToDomain)
            .OrderBy(history => history.OccurredAt)
            .ToArray();
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

    public async ValueTask<ArticleStorePriceUpdateCandidate> FindForPriceUpdateAsync(
        Ean13 ean13,
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        var entity = await context.Articles
            .AsNoTracking()
            .SingleOrDefaultAsync(article => article.Ean13 == ean13.Value, cancellationToken);

        if (entity is null)
        {
            return new(ArticleStorePriceUpdateCandidateStatus.NotFound, null);
        }

        if (!entity.IsActive)
        {
            return new(ArticleStorePriceUpdateCandidateStatus.Archived, null);
        }

        return new(ArticleStorePriceUpdateCandidateStatus.Active, ToDomain(entity));
    }

    public async ValueTask<ArticleStoreUpdateStatus> UpdatePriceHtAsync(
        Article article,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(article);

        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        var entity = await context.Articles
            .SingleOrDefaultAsync(
                current => current.Ean13 == article.Ean13.Value && current.Version == article.Version,
                cancellationToken);

        if (entity is null)
        {
            var exists = await context.Articles.AnyAsync(
                current => current.Ean13 == article.Ean13.Value,
                cancellationToken);
            return exists
                ? ArticleStoreUpdateStatus.Conflict
                : ArticleStoreUpdateStatus.NotFound;
        }

        if (!entity.IsActive)
        {
            return ArticleStoreUpdateStatus.Conflict;
        }

        entity.PriceHtCents = article.PriceHt.Cents;
        entity.Version++;
        try
        {
            await context.SaveChangesAsync(cancellationToken);
            return ArticleStoreUpdateStatus.Updated;
        }
        catch (DbUpdateConcurrencyException)
        {
            return ArticleStoreUpdateStatus.Conflict;
        }
    }

    public async ValueTask<ArticleStoreAttributeUpdateStatus> UpdateAttributesAsync(
        Article article,
        ArticleAttributeHistory history,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(article);
        ArgumentNullException.ThrowIfNull(history);

        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        try
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var entity = await context.Articles.SingleOrDefaultAsync(
                current => current.Ean13 == article.Ean13.Value
                    && current.IsActive
                    && current.Version == article.Version,
                cancellationToken);

            if (entity is null)
            {
                var exists = await context.Articles.AnyAsync(
                    current => current.Ean13 == article.Ean13.Value,
                    cancellationToken);
                return exists
                    ? ArticleStoreAttributeUpdateStatus.Conflict
                    : ArticleStoreAttributeUpdateStatus.NotFound;
            }

            entity.Name = article.Name;
            entity.NameSearchKey = ArticleNameSearchKey.From(article.Name);
            entity.Dlc = article.Dlc?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            entity.ConsumptionModes = article.Type == ArticleType.Food
                ? string.Join(',', article.ConsumptionModes.Select(ToWireMode))
                : null;
            entity.Packaging = article.Packaging is null ? null : ToWirePackaging(article.Packaging.Value);
            entity.Version++;
            context.ArticleLifecycleHistory.Add(ToEntity(history));

            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return ArticleStoreAttributeUpdateStatus.Updated;
        }
        catch (DbUpdateConcurrencyException)
        {
            return ArticleStoreAttributeUpdateStatus.Conflict;
        }
        catch (DbUpdateException exception) when (IsSqliteLock(exception))
        {
            return ArticleStoreAttributeUpdateStatus.Conflict;
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode is 5 or 6)
        {
            return ArticleStoreAttributeUpdateStatus.Conflict;
        }
    }

    public async ValueTask<IReadOnlyList<ArticleAttributeHistory>> ListAttributeHistoryAsync(
        Ean13? ean13 = null,
        CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        var query = context.ArticleLifecycleHistory
            .AsNoTracking()
            .Where(history => history.Kind == "attributes");
        if (ean13 is { } value)
        {
            query = query.Where(history => history.Ean13 == value.Value);
        }

        var entities = await query
            .OrderBy(history => history.Id)
            .ToListAsync(cancellationToken);
        return entities.Select(ToAttributeHistory).ToArray();
    }

    private static ArticleEntity ToEntity(Article article)
        => new()
        {
            Ean13 = article.Ean13.Value,
            Type = article.Type == ArticleType.Food ? "food" : "nonFood",
            Name = article.Name,
            NameSearchKey = ArticleNameSearchKey.From(article.Name),
            PriceHtCents = article.PriceHt.Cents,
            IsActive = article.IsActive,
            Version = article.Version,
            Dlc = article.Dlc?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            ConsumptionModes = article.Type == ArticleType.Food
                ? string.Join(',', article.ConsumptionModes.Select(ToWireMode))
                : null,
            Packaging = article.Packaging is null ? null : ToWirePackaging(article.Packaging.Value)
        };

    private static ArticleLifecycleHistoryEntity ToEntity(ArticleLifecycleHistory history)
        => new()
        {
            Ean13 = history.Ean13.Value,
            PreviousStatus = ToWireStatus(history.PreviousStatus),
            NextStatus = ToWireStatus(history.NextStatus),
            OccurredAt = history.OccurredAt.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture)
        };

    private static ArticleLifecycleHistoryEntity ToEntity(ArticleAttributeHistory history)
        => new()
        {
            Ean13 = history.Ean13.Value,
            PreviousStatus = "",
            NextStatus = "",
            OccurredAt = history.OccurredAt.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
            Kind = "attributes",
            ChangesJson = JsonSerializer.Serialize(history.Changes)
        };

    internal static Article ToDomain(ArticleEntity entity)
    {
        var result = Article.Reconstitute(
            new ArticleDraft
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
            },
            entity.IsActive,
            entity.Version);

        if (!result.IsSuccess || result.Value is null)
        {
            throw new InvalidOperationException("Stored Article data is invalid.");
        }

        return result.Value;
    }

    private static ArticleLifecycleHistory ToDomain(ArticleLifecycleHistoryEntity entity)
    {
        if (!Ean13.TryCreate(entity.Ean13, out var ean13)
            || !TryParseStatus(entity.PreviousStatus, out var previousStatus)
            || !TryParseStatus(entity.NextStatus, out var nextStatus)
            || !DateTimeOffset.TryParse(
                entity.OccurredAt,
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind,
                out var occurredAt))
        {
            throw new InvalidOperationException("Stored Article history data is invalid.");
        }

        return new ArticleLifecycleHistory(ean13, previousStatus, nextStatus, occurredAt);
    }

    private static ArticleAttributeHistory ToAttributeHistory(ArticleLifecycleHistoryEntity entity)
    {
        if (!Ean13.TryCreate(entity.Ean13, out var ean13)
            || !DateTimeOffset.TryParse(
                entity.OccurredAt,
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind,
                out var occurredAt)
            || string.IsNullOrWhiteSpace(entity.ChangesJson))
        {
            throw new InvalidOperationException("Stored Article attribute history data is invalid.");
        }

        var changes = JsonSerializer.Deserialize<IReadOnlyList<ArticleAttributeChange>>(entity.ChangesJson);
        return changes is null
            ? throw new InvalidOperationException("Stored Article attribute history data is invalid.")
            : new ArticleAttributeHistory(ean13, changes, occurredAt);
    }

    private static bool IsUniqueConstraintViolation(DbUpdateException exception)
        => exception.InnerException is SqliteException { SqliteErrorCode: 19 };

    private static bool IsSqliteLock(DbUpdateException exception)
        => exception.InnerException is SqliteException { SqliteErrorCode: 5 or 6 };

    private static string ToWireMode(ConsumptionMode mode)
        => mode == ConsumptionMode.Takeaway ? "takeaway" : "onsite";

    private static bool ToIsActive(ArticleLifecycleStatus status)
        => status == ArticleLifecycleStatus.Active;

    private static string ToWireStatus(ArticleLifecycleStatus status)
        => status == ArticleLifecycleStatus.Active ? "active" : "archived";

    private static bool TryParseStatus(string value, out ArticleLifecycleStatus status)
    {
        status = value.Equals("active", StringComparison.OrdinalIgnoreCase)
            ? ArticleLifecycleStatus.Active
            : ArticleLifecycleStatus.Archived;
        return value.Equals("active", StringComparison.OrdinalIgnoreCase)
            || value.Equals("archived", StringComparison.OrdinalIgnoreCase);
    }

    private static string ToWireType(ArticleType type)
        => type == ArticleType.Food ? "food" : "nonFood";

    private static string ToWirePackaging(PackagingCondition packaging)
        => packaging switch
        {
            PackagingCondition.New => "new",
            PackagingCondition.Refurbished => "refurbished",
            _ => "unsellable"
        };
}
