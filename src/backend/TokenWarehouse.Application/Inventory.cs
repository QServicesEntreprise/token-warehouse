using TokenWarehouse.Domain;

namespace TokenWarehouse.Application;

public sealed record RegisterInventoryCommand
{
    public string? Ean13 { get; init; }

    public int? CountedQuantity { get; init; }
}

public sealed record InventoryCommitPlan(
    Ean13 Ean13,
    int ExpectedPreviousPhysicalStock,
    StockOperation Operation,
    int ExpectedPositionVersion = 0);

public enum StockMutationCommitStatus
{
    Committed,
    Conflict,
    Failed
}

public sealed record StockMutationCommitResult(
    StockMutationCommitStatus Status,
    StockPosition? Position)
{
    public static StockMutationCommitResult Committed(StockPosition position)
        => new(StockMutationCommitStatus.Committed, position);

    public static StockMutationCommitResult Conflict()
        => new(StockMutationCommitStatus.Conflict, null);

    public static StockMutationCommitResult Failed()
        => new(StockMutationCommitStatus.Failed, null);
}

public interface IStockMutationCommitter
{
    ValueTask<StockMutationCommitResult> CommitAsync(
        InventoryCommitPlan plan,
        CancellationToken cancellationToken = default);
}

public interface IStockOperationReader
{
    ValueTask<StockOperation?> FindByIdAsync(
        string id,
        CancellationToken cancellationToken = default);
}

public sealed record InventoryReceipt(
    StockOperation Operation,
    StockPositionView Position);

public enum InventoryRegistrationStatus
{
    Committed,
    ValidationFailed,
    ArticleNotFound,
    Conflict,
    PersistenceFailed
}

public sealed record InventoryRegistrationResult(
    InventoryRegistrationStatus Status,
    InventoryReceipt? Receipt,
    IReadOnlyList<ArticleValidationError> Errors);

public enum InventoryReadStatus
{
    Found,
    NotFound,
    PersistenceFailed
}

public sealed record InventoryReadResult(
    InventoryReadStatus Status,
    StockOperation? Operation);

public interface IRegisterInventoryUseCase
{
    Task<InventoryRegistrationResult> RegisterAsync(
        RegisterInventoryCommand command,
        CancellationToken cancellationToken = default);
}

public interface IReadInventoryUseCase
{
    Task<InventoryReadResult> GetAsync(
        string id,
        CancellationToken cancellationToken = default);
}

public sealed class InventoryApplication(
    IArticleSellabilityReader articleReader,
    IStockPositionReader positionReader,
    IStockMutationCommitter committer,
    IClock clock,
    IStockOperationReader? operationReader = null) : IRegisterInventoryUseCase, IReadInventoryUseCase
{
    public async Task<InventoryRegistrationResult> RegisterAsync(
        RegisterInventoryCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);

        var errors = new List<ArticleValidationError>();
        if (!Ean13.TryCreate(command.Ean13, out var ean13))
        {
            errors.Add(new(
                "inventory.ean13.invalid",
                "ean13",
                "L’EAN-13 doit contenir 13 chiffres et un checksum valide."));
        }

        if (command.CountedQuantity is null)
        {
            errors.Add(new(
                "inventory.countedQuantity.required",
                "countedQuantity",
                "La quantité comptée est requise."));
        }
        else if (command.CountedQuantity < 0)
        {
            errors.Add(new(
                "inventory.countedQuantity.non_negative",
                "countedQuantity",
                "La quantité comptée doit être un entier supérieur ou égal à zéro."));
        }

        if (errors.Count > 0)
        {
            return new(InventoryRegistrationStatus.ValidationFailed, null, errors);
        }

        try
        {
            var article = await articleReader.FindSellabilityByEanAsync(ean13, cancellationToken);
            if (article is null)
            {
                return new(
                    InventoryRegistrationStatus.ArticleNotFound,
                    null,
                    [new(
                        "inventory.article.not_found",
                        "ean13",
                        "L’Article demandé est introuvable.")]);
            }

            var position = await positionReader.FindByEanAsync(ean13, cancellationToken);
            var previousPhysicalStock = position?.PhysicalQuantity ?? 0;
            var reconciliation = InventoryReconciliation.Reconcile(
                new Quantity(previousPhysicalStock),
                new Quantity(command.CountedQuantity!.Value));
            var operation = StockOperation.CreateInventory(
                Guid.NewGuid().ToString("N"),
                ean13,
                reconciliation,
                clock.UtcNow);
            var plan = new InventoryCommitPlan(
                ean13,
                previousPhysicalStock,
                operation,
                position?.Version ?? 0);
            var commit = await committer.CommitAsync(plan, cancellationToken);

            return commit.Status switch
            {
                StockMutationCommitStatus.Committed when commit.Position is not null
                    => new(
                        InventoryRegistrationStatus.Committed,
                        new InventoryReceipt(
                            operation,
                            StockPositionView.From(article, commit.Position, clock.WarehouseDate)),
                        []),
                StockMutationCommitStatus.Conflict
                    => new(InventoryRegistrationStatus.Conflict, null, []),
                _ => new(InventoryRegistrationStatus.PersistenceFailed, null, [])
            };
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return new(InventoryRegistrationStatus.PersistenceFailed, null, []);
        }
    }

    public async Task<InventoryReadResult> GetAsync(
        string id,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(id) || operationReader is null)
        {
            return new(InventoryReadStatus.NotFound, null);
        }

        try
        {
            var operation = await operationReader.FindByIdAsync(id, cancellationToken);
            return operation is null
                ? new(InventoryReadStatus.NotFound, null)
                : new(InventoryReadStatus.Found, operation);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return new(InventoryReadStatus.PersistenceFailed, null);
        }
    }
}
