using TokenWarehouse.Domain;

namespace TokenWarehouse.Application;

public sealed record SupplyCommand
{
    public string? Ean13 { get; init; }

    public int? Quantity { get; init; }

    public IReadOnlyList<string> UnsupportedFields { get; init; } = [];
}

public enum SupplyStatus
{
    Committed,
    ValidationFailed,
    NotFound,
    Conflict
}

public sealed record SupplyReceipt(
    StockOperation Operation,
    StockPositionView Position);

public sealed record SupplyResult(
    SupplyStatus Status,
    SupplyReceipt? Receipt,
    IReadOnlyList<ArticleValidationError> Errors);

public sealed record SupplyCommitRequest(
    ArticleSellabilitySnapshot ArticleSnapshot,
    StockPosition? CurrentPosition,
    StockPosition Position,
    StockOperation Operation);

public enum SupplyCommitStatus
{
    Committed,
    Conflict
}

public sealed record SupplyCommitResult(
    SupplyCommitStatus Status,
    StockPosition? Position,
    StockOperation? Operation);

public interface ISupplyCommitter
{
    ValueTask<SupplyCommitResult> CommitAsync(
        SupplyCommitRequest request,
        CancellationToken cancellationToken = default);
}

public interface IRecordSupplyUseCase
{
    Task<SupplyResult> RecordAsync(
        SupplyCommand command,
        CancellationToken cancellationToken = default);
}

public sealed class SupplyApplication(
    IArticleSellabilityReader articleReader,
    IStockPositionReader stockReader,
    ISupplyCommitter committer,
    IClock clock) : IRecordSupplyUseCase
{
    public async Task<SupplyResult> RecordAsync(
        SupplyCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);

        var errors = command.UnsupportedFields
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(field => new ArticleValidationError(
                "supply.field.unsupported",
                field,
                $"Le champ « {field} » n’est pas accepté pour un Approvisionnement."))
            .ToList();

        if (!Ean13.TryCreate(command.Ean13, out var ean13))
        {
            errors.Add(new(
                "supply.ean13.invalid",
                "ean13",
                "L’EAN-13 doit contenir 13 chiffres et un checksum valide."));
        }

        if (!Quantity.TryCreatePositive(command.Quantity, out var quantity))
        {
            errors.Add(new(
                command.Quantity is null ? "supply.quantity.required" : "supply.quantity.invalid",
                "quantity",
                "La quantité d’un Approvisionnement doit être un entier strictement positif."));
        }

        if (errors.Count > 0)
        {
            return new(SupplyStatus.ValidationFailed, null, errors);
        }

        var articleSnapshot = await articleReader.FindSellabilityByEanAsync(ean13, cancellationToken);
        if (articleSnapshot is null)
        {
            return new(SupplyStatus.NotFound, null, []);
        }

        if (!articleSnapshot.IsActive)
        {
            return new(
                SupplyStatus.Conflict,
                null,
                [new(
                    "article_archived",
                    "ean13",
                    "Un Article archivé n’accepte plus d’Approvisionnement.")]);
        }

        var currentPosition = await stockReader.FindByEanAsync(ean13, cancellationToken);
        StockPosition nextPosition;
        try
        {
            nextPosition = (currentPosition ?? new StockPosition(ean13, 0)).Add(quantity);
        }
        catch (OverflowException)
        {
            return new(
                SupplyStatus.ValidationFailed,
                null,
                [new(
                    "supply.quantity.overflow",
                    "quantity",
                    "La quantité dépasse la capacité du Stock.")]);
        }

        var operation = StockOperation.CreateSupply(
            Guid.NewGuid().ToString("N"),
            ean13,
            quantity,
            clock.UtcNow);
        var committed = await committer.CommitAsync(
            new SupplyCommitRequest(articleSnapshot, currentPosition, nextPosition, operation),
            cancellationToken);

        if (committed.Status != SupplyCommitStatus.Committed)
        {
            return new(
                SupplyStatus.Conflict,
                null,
                [new(
                    "supply.commit.conflict",
                    "ean13",
                    "L’Approvisionnement n’a pas pu être engagé avec l’état courant du Stock.")]);
        }

        var committedPosition = committed.Position
            ?? throw new InvalidOperationException("A committed supply must return its position.");
        var committedOperation = committed.Operation
            ?? throw new InvalidOperationException("A committed supply must return its operation.");
        return new(
            SupplyStatus.Committed,
            new SupplyReceipt(
                committedOperation,
                StockPositionView.From(
                    articleSnapshot,
                    committedPosition.PhysicalQuantity,
                    clock.WarehouseDate)),
            []);
    }
}
