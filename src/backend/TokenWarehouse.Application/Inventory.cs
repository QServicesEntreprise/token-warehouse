using TokenWarehouse.Domain;

namespace TokenWarehouse.Application;

public sealed record RegisterInventoryCommand
{
    public string? Ean13 { get; init; }

    public int? CountedQuantity { get; init; }
}

public sealed record RegisterBulkInventoryLineCommand
{
    public int LineNumber { get; init; }

    public string? Ean13 { get; init; }

    public int? CountedQuantity { get; init; }
}

public sealed record RegisterBulkInventoryCommand
{
    public IReadOnlyList<RegisterBulkInventoryLineCommand>? Lines { get; init; }
}

public sealed record InventoryCommitLinePlan(
    Ean13 Ean13,
    int ExpectedPreviousPhysicalStock,
    StockOperationLine OperationLine,
    int ExpectedPositionVersion,
    int ExpectedArticleVersion);

public sealed record InventoryCommitPlan
{
    public InventoryCommitPlan(
        Ean13 ean13,
        int expectedPreviousPhysicalStock,
        StockOperation operation,
        int expectedPositionVersion = 0,
        int expectedArticleVersion = 0)
    {
        Operation = operation;
        Lines =
        [
            new(
                ean13,
                expectedPreviousPhysicalStock,
                operation.Lines[0],
                expectedPositionVersion,
                expectedArticleVersion)
        ];
    }

    public InventoryCommitPlan(
        StockOperation operation,
        IReadOnlyList<InventoryCommitLinePlan> lines)
    {
        ArgumentNullException.ThrowIfNull(operation);
        ArgumentNullException.ThrowIfNull(lines);
        if (lines.Count != operation.Lines.Count)
        {
            throw new ArgumentException("The commit plan must contain one entry per operation line.", nameof(lines));
        }

        Operation = operation;
        Lines = Array.AsReadOnly(lines.ToArray());
    }

    public StockOperation Operation { get; }

    public IReadOnlyList<InventoryCommitLinePlan> Lines { get; }

    public Ean13 Ean13 => Lines[0].Ean13;

    public int ExpectedPreviousPhysicalStock => Lines[0].ExpectedPreviousPhysicalStock;

    public int ExpectedPositionVersion => Lines[0].ExpectedPositionVersion;

    public int ExpectedArticleVersion => Lines[0].ExpectedArticleVersion;
}

public enum StockMutationCommitStatus
{
    Committed,
    Conflict,
    Failed
}

public sealed record StockMutationCommitResult
{
    public StockMutationCommitResult(
        StockMutationCommitStatus status,
        StockPosition? position)
        : this(status, position is null ? [] : [position])
    {
    }

    public StockMutationCommitResult(
        StockMutationCommitStatus status,
        IReadOnlyList<StockPosition> positions)
    {
        Status = status;
        Positions = Array.AsReadOnly(positions.ToArray());
    }

    public StockMutationCommitStatus Status { get; }

    public IReadOnlyList<StockPosition> Positions { get; }

    public StockPosition? Position => Positions.FirstOrDefault();

    public static StockMutationCommitResult Committed(StockPosition position)
        => new(StockMutationCommitStatus.Committed, position);

    public static StockMutationCommitResult Committed(IReadOnlyList<StockPosition> positions)
        => new(StockMutationCommitStatus.Committed, positions);

    public static StockMutationCommitResult Conflict()
        => new(StockMutationCommitStatus.Conflict, []);

    public static StockMutationCommitResult Failed()
        => new(StockMutationCommitStatus.Failed, []);
}

public interface IStockMutationCommitter
{
    ValueTask<StockMutationCommitResult> CommitAsync(
        InventoryCommitPlan plan,
        CancellationToken cancellationToken = default);

    ValueTask<StockMutationCommitResult> CommitAsync(
        CounterMovementCommitPlan plan,
        CancellationToken cancellationToken = default)
        => throw new NotSupportedException("This committer does not support counter-movements.");

    ValueTask<StockMutationCommitResult> CommitAsync(
        StockSaleCommitPlan plan,
        CancellationToken cancellationToken = default)
        => throw new NotSupportedException("This committer does not support Stock sales.");

    ValueTask<StockMutationCommitResult> CommitAsync(
        StockSaleCommitPlan plan,
        IStockSaleCommitParticipant participant,
        CancellationToken cancellationToken = default)
        => throw new NotSupportedException("This committer does not support Stock sale participants.");
}

public interface IStockOperationReader
{
    ValueTask<StockOperation?> FindByIdAsync(
        string id,
        CancellationToken cancellationToken = default);

    ValueTask<StockOperation?> FindCounterMovementBySourceIdAsync(
        string sourceOperationId,
        CancellationToken cancellationToken = default)
        => ValueTask.FromResult<StockOperation?>(null);

    ValueTask<IReadOnlyList<StockOperation>> ListAsync(
        CancellationToken cancellationToken = default)
        => ValueTask.FromResult<IReadOnlyList<StockOperation>>([]);

    async ValueTask<IReadOnlyList<StockOperationReadFact>> ListForDashboardAsync(
        CancellationToken cancellationToken = default)
        => (await ListAsync(cancellationToken))
            .Select(operation => new StockOperationReadFact(operation))
            .ToArray();

    ValueTask<IReadOnlyList<StockOperation>> ListCorrectableAsync(
        CancellationToken cancellationToken = default)
        => ValueTask.FromResult<IReadOnlyList<StockOperation>>([]);
}

public sealed record InventoryReceipt(
    StockOperation Operation,
    StockPositionView Position);

public sealed record BulkInventoryLineReceipt(
    StockOperationLine Operation,
    StockPositionView Position);

public sealed record BulkInventoryReceipt(
    StockOperation Operation,
    IReadOnlyList<BulkInventoryLineReceipt> Lines);

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

public enum BulkInventoryRegistrationStatus
{
    Committed,
    ValidationFailed,
    ArticleNotFound,
    Conflict,
    PersistenceFailed
}

public sealed record BulkInventoryRegistrationResult(
    BulkInventoryRegistrationStatus Status,
    BulkInventoryReceipt? Receipt,
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

public interface IRegisterBulkInventoryUseCase
{
    Task<BulkInventoryRegistrationResult> RegisterBulkAsync(
        RegisterBulkInventoryCommand command,
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
    IStockOperationReader? operationReader = null) : IRegisterInventoryUseCase, IRegisterBulkInventoryUseCase, IReadInventoryUseCase
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
                position?.Version ?? 0,
                article.Version);
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

    public async Task<BulkInventoryRegistrationResult> RegisterBulkAsync(
        RegisterBulkInventoryCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);

        var submittedLines = command.Lines ?? [];
        var errors = new List<ArticleValidationError>();
        if (submittedLines.Count == 0)
        {
            errors.Add(new(
                "inventory.lines.required",
                "lines",
                "L’Inventaire en masse doit contenir au moins une ligne."));
        }

        var validLines = new List<(int LineNumber, Ean13 Ean13, int CountedQuantity)>();
        for (var index = 0; index < submittedLines.Count; index++)
        {
            var submittedLine = submittedLines[index];
            var lineNumber = index + 1;
            var fieldPrefix = $"lines[{lineNumber - 1}]";
            if (submittedLine is null)
            {
                errors.Add(new(
                    "inventory.line.invalid",
                    fieldPrefix,
                    "La ligne d’Inventaire est invalide."));
                continue;
            }

            var lineIsValid = true;

            if (!Ean13.TryCreate(submittedLine.Ean13, out var ean13))
            {
                errors.Add(new(
                    "inventory.ean13.invalid",
                    $"{fieldPrefix}.ean13",
                    "L’EAN-13 doit contenir 13 chiffres et un checksum valide."));
                lineIsValid = false;
            }

            if (submittedLine.CountedQuantity is null)
            {
                errors.Add(new(
                    "inventory.countedQuantity.required",
                    $"{fieldPrefix}.countedQuantity",
                    "La quantité comptée est requise."));
                lineIsValid = false;
            }
            else if (submittedLine.CountedQuantity < 0)
            {
                errors.Add(new(
                    "inventory.countedQuantity.non_negative",
                    $"{fieldPrefix}.countedQuantity",
                    "La quantité comptée doit être un entier supérieur ou égal à zéro."));
                lineIsValid = false;
            }

            if (lineIsValid)
            {
                validLines.Add((lineNumber, ean13, submittedLine.CountedQuantity!.Value));
            }
        }

        foreach (var duplicate in validLines.GroupBy(line => line.Ean13))
        {
            if (duplicate.Count() < 2)
            {
                continue;
            }

            foreach (var line in duplicate)
            {
                errors.Add(new(
                    "inventory.ean13.duplicate",
                    $"lines[{line.LineNumber - 1}].ean13",
                    "Un même Article ne peut apparaître qu’une seule fois dans l’Inventaire en masse."));
            }
        }

        if (errors.Count > 0)
        {
            return new(BulkInventoryRegistrationStatus.ValidationFailed, null, errors);
        }

        try
        {
            var eans = validLines.Select(line => line.Ean13).ToArray();
            var articles = (await articleReader.FindManyAsync(eans, cancellationToken))
                .ToDictionary(article => article.Ean13);
            var missingArticles = validLines
                .Where(line => !articles.ContainsKey(line.Ean13))
                .ToArray();
            if (missingArticles.Length > 0)
            {
                return new(
                    BulkInventoryRegistrationStatus.ArticleNotFound,
                    null,
                    missingArticles
                        .Select(line => new ArticleValidationError(
                            "inventory.article.not_found",
                            $"lines[{line.LineNumber - 1}].ean13",
                            "L’Article demandé est introuvable."))
                        .ToArray());
            }

            var positions = (await positionReader.FindByEansAsync(eans, cancellationToken))
                .ToDictionary(position => position.Ean13);
            var operationLines = validLines
                .Select(line => StockOperationLine.CreateInventoryLine(
                    line.LineNumber,
                    line.Ean13,
                    InventoryReconciliation.Reconcile(
                        positions.GetValueOrDefault(line.Ean13)?.PhysicalQuantity ?? 0,
                        line.CountedQuantity)))
                .ToArray();
            var timestampUtc = clock.UtcNow;
            var warehouseDate = clock.WarehouseDate;
            var operation = StockOperation.CreateInventory(
                Guid.NewGuid().ToString("N"),
                operationLines,
                timestampUtc);
            var plan = new InventoryCommitPlan(
                operation,
                operationLines
                    .Select(line =>
                    {
                        var position = positions.GetValueOrDefault(line.Ean13);
                        return new InventoryCommitLinePlan(
                            line.Ean13,
                            line.PreviousPhysicalStock,
                            line,
                            position?.Version ?? 0,
                            articles[line.Ean13].Version);
                    })
                    .ToArray());
            var commit = await committer.CommitAsync(plan, cancellationToken);

            return commit.Status switch
            {
                StockMutationCommitStatus.Committed
                    when commit.Positions.Count == operationLines.Length
                        && operationLines.All(line => commit.Positions.Any(position => position.Ean13 == line.Ean13))
                    => new(
                        BulkInventoryRegistrationStatus.Committed,
                        new BulkInventoryReceipt(
                            operation,
                            operationLines
                                .Select(line => new BulkInventoryLineReceipt(
                                    line,
                                    StockPositionView.From(
                                        articles[line.Ean13],
                                        commit.Positions.Single(position => position.Ean13 == line.Ean13),
                                        warehouseDate)))
                                .ToArray()),
                        []),
                StockMutationCommitStatus.Conflict
                    => new(BulkInventoryRegistrationStatus.Conflict, null, []),
                _ => new(BulkInventoryRegistrationStatus.PersistenceFailed, null, [])
            };
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return new(BulkInventoryRegistrationStatus.PersistenceFailed, null, []);
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
