using TokenWarehouse.Domain;

namespace TokenWarehouse.Application;

public sealed record StockSaleCommand
{
    public string? Ean13 { get; init; }

    public int? Quantity { get; init; }

    internal int? ExpectedArticleVersion { get; init; }
}

public sealed record StockSaleCommitPlan(
    ArticleSellabilitySnapshot ArticleSnapshot,
    StockPosition? CurrentPosition,
    StockPosition Position,
    StockOperation Operation,
    DateOnly WarehouseDate,
    int? ExpectedArticleVersion = null);

public sealed record StockSaleReceipt(
    StockOperation Operation,
    StockPositionView Position);

public enum StockSaleStatus
{
    Available,
    Committed,
    ValidationFailed,
    ArticleNotFound,
    NotSellable,
    OutOfStock,
    Conflict,
    PersistenceFailed
}

public sealed record StockSaleCheckResult(
    StockSaleStatus Status,
    StockPositionView? Position,
    IReadOnlyList<ArticleValidationError> Errors);

public sealed record StockSaleResult(
    StockSaleStatus Status,
    StockSaleReceipt? Receipt,
    IReadOnlyList<ArticleValidationError> Errors);

public sealed record StockSaleCommitData
{
    public StockSaleCommitData(string type, string payload)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(type);
        ArgumentNullException.ThrowIfNull(payload);
        Type = type;
        Payload = payload;
    }

    public string Type { get; }

    public string Payload { get; }

    public SaleFinancialSnapshot? FinancialSnapshot { get; init; }
}

public interface IStockSaleTransaction
{
    ValueTask StageAsync(
        StockSaleCommitData data,
        CancellationToken cancellationToken = default);
}

public interface IStockSaleCommitParticipant
{
    ValueTask PrepareAsync(
        IStockSaleTransaction transaction,
        StockOperation operation,
        StockPositionView resultingPosition,
        CancellationToken cancellationToken = default);
}

public interface IStockSaleContract
{
    Task<StockSaleCheckResult> CheckSellabilityAsync(
        StockSaleCommand command,
        CancellationToken cancellationToken = default);

    Task<StockSaleResult> RecordAsync(
        StockSaleCommand command,
        CancellationToken cancellationToken = default);

    Task<StockSaleResult> RecordAsync(
        StockSaleCommand command,
        IStockSaleCommitParticipant participant,
        CancellationToken cancellationToken = default);
}

public sealed class StockSaleApplication(
    IArticleSellabilityReader articleReader,
    IStockPositionReader positionReader,
    IStockMutationCommitter committer,
    IClock clock) : IStockSaleContract
{
    public async Task<StockSaleCheckResult> CheckSellabilityAsync(
        StockSaleCommand command,
        CancellationToken cancellationToken = default)
    {
        if (!TryParse(command, out var ean13, out var quantity, out var errors))
        {
            return new(StockSaleStatus.ValidationFailed, null, errors);
        }

        try
        {
            var article = await articleReader.FindSellabilityByEanAsync(ean13, cancellationToken);
            if (article is null)
            {
                return FailureCheck(
                    StockSaleStatus.ArticleNotFound,
                    "ARTICLE_NOT_FOUND",
                    "L’Article demandé est introuvable.",
                    ean13.Value);
            }

            var position = await positionReader.FindByEanAsync(ean13, cancellationToken);
            var view = StockPositionView.From(article, position, clock.WarehouseDate);
            return Check(view, quantity);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return FailureCheck(
                StockSaleStatus.PersistenceFailed,
                "PERSISTENCE_FAILURE",
                "La vendabilité ne peut pas être vérifiée.",
                "ean13");
        }
    }

    public Task<StockSaleResult> RecordAsync(
        StockSaleCommand command,
        CancellationToken cancellationToken = default)
        => RecordCoreAsync(command, null, cancellationToken);

    public Task<StockSaleResult> RecordAsync(
        StockSaleCommand command,
        IStockSaleCommitParticipant participant,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(participant);
        return RecordCoreAsync(command, participant, cancellationToken);
    }

    private async Task<StockSaleResult> RecordCoreAsync(
        StockSaleCommand command,
        IStockSaleCommitParticipant? participant,
        CancellationToken cancellationToken)
    {
        if (!TryParse(command, out var ean13, out var quantity, out var errors))
        {
            return new(StockSaleStatus.ValidationFailed, null, errors);
        }

        try
        {
            var article = await articleReader.FindSellabilityByEanAsync(ean13, cancellationToken);
            if (article is null)
            {
                return FailureResult(
                    StockSaleStatus.ArticleNotFound,
                    "ARTICLE_NOT_FOUND",
                    "L’Article demandé est introuvable.",
                    ean13.Value);
            }

            if (command.ExpectedArticleVersion is { } expectedArticleVersion
                && article.Version != expectedArticleVersion)
            {
                return FailureResult(
                    StockSaleStatus.Conflict,
                    "POSITION_CONFLICT",
                    "L’Article a changé pendant la Vente.",
                    "ean13");
            }

            var currentPosition = await positionReader.FindByEanAsync(ean13, cancellationToken);
            var occurredAt = clock.UtcNow;
            var warehouseDate = clock.WarehouseDate;
            var view = StockPositionView.From(article, currentPosition, warehouseDate);
            var check = Check(view, quantity);
            if (check.Status != StockSaleStatus.Available)
            {
                return new(check.Status, null, check.Errors);
            }

            var operation = StockOperation.CreateSale(
                Guid.NewGuid().ToString("N"),
                ean13,
                quantity,
                occurredAt);
            var nextPosition = (currentPosition ?? new StockPosition(ean13, 0))
                .ApplyEffect(operation.Lines.Single().StockEffect);
            var commitPlan = new StockSaleCommitPlan(
                article,
                currentPosition,
                nextPosition,
                operation,
                warehouseDate,
                command.ExpectedArticleVersion ?? article.Version);
            var committed = participant is null
                ? await committer.CommitAsync(commitPlan, cancellationToken)
                : await committer.CommitAsync(commitPlan, participant, cancellationToken);

            return committed.Status switch
            {
                StockMutationCommitStatus.Committed
                    when committed.Position is { } position && position.Ean13 == ean13
                    => new(
                        StockSaleStatus.Committed,
                        new StockSaleReceipt(
                            operation,
                            StockPositionView.From(article, position, warehouseDate)),
                        []),
                StockMutationCommitStatus.Conflict
                    => FailureResult(
                        StockSaleStatus.Conflict,
                        "POSITION_CONFLICT",
                        "La position Stock a changé pendant la Vente.",
                        "ean13"),
                _ => FailureResult(
                    StockSaleStatus.PersistenceFailed,
                    "PERSISTENCE_FAILURE",
                    "L’effet Stock de la Vente n’a pas pu être enregistré.",
                    "ean13")
            };
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (InvalidOperationException)
        {
            return FailureResult(
                StockSaleStatus.Conflict,
                "POSITION_CONFLICT",
                "La position Stock a changé pendant la Vente.",
                "ean13");
        }
        catch (Exception)
        {
            return FailureResult(
                StockSaleStatus.PersistenceFailed,
                "PERSISTENCE_FAILURE",
                "L’effet Stock de la Vente n’a pas pu être enregistré.",
                "ean13");
        }
    }

    private static StockSaleCheckResult Check(
        StockPositionView position,
        Quantity quantity)
    {
        if (position.Availability == StockAvailability.NotSellable)
        {
            var reason = position.Reason switch
            {
                SellabilityReason.Archived => "ARCHIVED",
                SellabilityReason.DlcExpired => "DLC_EXPIRED",
                SellabilityReason.UnsellablePackaging => "UNSELLABLE_PACKAGING",
                _ => "UNKNOWN"
            };
            return new(
                StockSaleStatus.NotSellable,
                position,
                [new(
                    $"NOT_SELLABLE/{reason}",
                    "ean13",
                    $"L’Article ne peut pas être vendu ({reason}).")]);
        }

        if (quantity.Value > position.SellableQuantity)
        {
            return new(
                StockSaleStatus.OutOfStock,
                position,
                [new(
                    "OUT_OF_STOCK",
                    "quantity",
                    "La quantité demandée dépasse le Stock vendable courant.")]);
        }

        return new(StockSaleStatus.Available, position, []);
    }

    private static bool TryParse(
        StockSaleCommand? command,
        out Ean13 ean13,
        out Quantity quantity,
        out IReadOnlyList<ArticleValidationError> errors)
    {
        var validationErrors = new List<ArticleValidationError>();
        if (!Ean13.TryCreate(command?.Ean13, out ean13))
        {
            validationErrors.Add(new(
                "INVALID_INPUT",
                "ean13",
                "L’EAN-13 doit contenir 13 chiffres et un checksum valide."));
        }

        if (!Quantity.TryCreatePositive(command?.Quantity, out quantity))
        {
            validationErrors.Add(new(
                "INVALID_INPUT",
                "quantity",
                "La quantité doit être un entier strictement positif."));
        }

        errors = validationErrors;
        return validationErrors.Count == 0;
    }

    private static StockSaleCheckResult FailureCheck(
        StockSaleStatus status,
        string code,
        string message,
        string field)
        => new(status, null, [new(code, field, message)]);

    private static StockSaleResult FailureResult(
        StockSaleStatus status,
        string code,
        string message,
        string field)
        => new(status, null, [new(code, field, message)]);
}
