using TokenWarehouse.Domain;

namespace TokenWarehouse.Application;

public sealed record SupplyCommand
{
    public string? Ean13 { get; init; }

    public int? Quantity { get; init; }

    public IReadOnlyList<string> UnsupportedFields { get; init; } = [];
}

public sealed record BulkSupplyLineCommand
{
    public string? Ean13 { get; init; }

    public int? Quantity { get; init; }

    public bool IsObject { get; init; } = true;

    public bool Ean13Provided { get; init; }

    public bool QuantityProvided { get; init; }

    public IReadOnlyList<string> UnsupportedFields { get; init; } = [];
}

public sealed record BulkSupplyCommand
{
    public IReadOnlyList<BulkSupplyLineCommand>? Lines { get; init; }

    public IReadOnlyList<ArticleValidationError> StructuralErrors { get; init; } = [];

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

public sealed record BulkSupplyReceipt(
    StockOperation Operation,
    IReadOnlyList<StockPositionView> Positions);

public sealed record SupplyResult(
    SupplyStatus Status,
    SupplyReceipt? Receipt,
    IReadOnlyList<ArticleValidationError> Errors);

public enum BulkSupplyStatus
{
    Committed,
    ValidationFailed,
    NotFound,
    Conflict,
    PersistenceFailed
}

public sealed record BulkSupplyResult(
    BulkSupplyStatus Status,
    BulkSupplyReceipt? Receipt,
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

public sealed record BulkSupplyCommitLine(
    ArticleSellabilitySnapshot ArticleSnapshot,
    StockPosition? CurrentPosition,
    StockPosition Position,
    StockOperationLine OperationLine);

public sealed record BulkSupplyCommitRequest(
    StockOperation Operation,
    IReadOnlyList<BulkSupplyCommitLine> Lines);

public enum BulkSupplyCommitStatus
{
    Committed,
    Conflict,
    Failed
}

public sealed record BulkSupplyCommitResult(
    BulkSupplyCommitStatus Status,
    StockOperation? Operation,
    IReadOnlyList<StockPosition>? Positions)
{
    public static BulkSupplyCommitResult Committed(
        StockOperation operation,
        IReadOnlyList<StockPosition> positions)
        => new(BulkSupplyCommitStatus.Committed, operation, positions);

    public static BulkSupplyCommitResult Conflict()
        => new(BulkSupplyCommitStatus.Conflict, null, null);

    public static BulkSupplyCommitResult Failed()
        => new(BulkSupplyCommitStatus.Failed, null, null);
}

public interface ISupplyCommitter
{
    ValueTask<SupplyCommitResult> CommitAsync(
        SupplyCommitRequest request,
        CancellationToken cancellationToken = default);

    ValueTask<BulkSupplyCommitResult> CommitAsync(
        BulkSupplyCommitRequest request,
        CancellationToken cancellationToken = default)
        => throw new NotSupportedException("This committer does not support bulk supplies.");
}

public interface IRecordSupplyUseCase
{
    Task<SupplyResult> RecordAsync(
        SupplyCommand command,
        CancellationToken cancellationToken = default);
}

public interface IRecordBulkSupplyUseCase
{
    Task<BulkSupplyResult> RecordBulkAsync(
        BulkSupplyCommand command,
        CancellationToken cancellationToken = default);
}

public sealed class SupplyApplication(
    IArticleSellabilityReader articleReader,
    IStockPositionReader stockReader,
    ISupplyCommitter committer,
    IClock clock) : IRecordSupplyUseCase, IRecordBulkSupplyUseCase
{
    public async Task<BulkSupplyResult> RecordBulkAsync(
        BulkSupplyCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);

        var errors = command.StructuralErrors.ToList();
        errors.AddRange(command.UnsupportedFields.Select(field => new ArticleValidationError(
            "bulk_supply.field.unsupported",
            "body",
            $"Le champ « {field} » n’est pas accepté pour un Approvisionnement en masse.")));
        if (command.Lines is null)
        {
            errors.Add(new(
                "bulk_supply.lines.required",
                "lines",
                "La collection de lignes est requise."));
        }
        else if (command.Lines.Count == 0)
        {
            errors.Add(new(
                "bulk_supply.lines.empty",
                "lines",
                "Un Approvisionnement en masse doit contenir au moins une ligne."));
        }

        var parsedLines = new List<(int Index, Ean13 Ean13, Quantity Quantity)>();
        var firstLineByEan = new Dictionary<Ean13, int>();
        if (command.Lines is not null)
        {
            for (var index = 0; index < command.Lines.Count; index++)
            {
                var line = command.Lines[index];
                if (!line.IsObject)
                {
                    errors.Add(new(
                        "bulk_supply.line.invalid",
                        LineField(index),
                        "Chaque ligne doit être un objet contenant un EAN-13 et une quantité."));
                    continue;
                }

                errors.AddRange(line.UnsupportedFields.Select(field => new ArticleValidationError(
                    "bulk_supply.line.field.unsupported",
                    $"{LineField(index)}.{field}",
                    $"Le champ « {field} » n’est pas accepté sur une ligne d’Approvisionnement.")));

                var validEan13 = Ean13.TryCreate(line.Ean13, out var ean13);
                if (!validEan13)
                {
                    errors.Add(new(
                        line.Ean13 is null && !line.Ean13Provided
                            ? "bulk_supply.ean13.required"
                            : "bulk_supply.ean13.invalid",
                        $"{LineField(index)}.ean13",
                        "L’EAN-13 doit contenir 13 chiffres et un checksum valide."));
                }

                var validQuantity = Quantity.TryCreatePositive(line.Quantity, out var quantity);
                if (!validQuantity)
                {
                    errors.Add(new(
                        line.Quantity is null && !line.QuantityProvided
                            ? "bulk_supply.quantity.required"
                            : "bulk_supply.quantity.invalid",
                        $"{LineField(index)}.quantity",
                        "La quantité d’un Approvisionnement doit être un entier strictement positif."));
                }

                if (!validEan13 || !validQuantity)
                {
                    continue;
                }

                if (firstLineByEan.TryGetValue(ean13, out var firstIndex))
                {
                    errors.Add(new(
                        "bulk_supply.ean13.duplicate",
                        $"{LineField(firstIndex)}.ean13",
                        "Un même Article ne peut apparaître qu’une seule fois dans la livraison."));
                    errors.Add(new(
                        "bulk_supply.ean13.duplicate",
                        $"{LineField(index)}.ean13",
                        "Un même Article ne peut apparaître qu’une seule fois dans la livraison."));
                    continue;
                }

                firstLineByEan[ean13] = index;
                parsedLines.Add((index, ean13, quantity));
            }
        }

        if (errors.Count > 0)
        {
            return new(BulkSupplyStatus.ValidationFailed, null, errors);
        }

        var requestedEans = parsedLines.Select(line => line.Ean13).ToArray();
        var articles = await ReadArticlesAsync(requestedEans, cancellationToken);
        var unknownArticle = false;
        var archivedArticle = false;
        foreach (var line in parsedLines)
        {
            if (!articles.TryGetValue(line.Ean13, out var article))
            {
                unknownArticle = true;
                errors.Add(new(
                    "bulk_supply.article.not_found",
                    $"{LineField(line.Index)}.ean13",
                    "L’Article demandé est introuvable."));
            }
            else if (!article.IsActive)
            {
                archivedArticle = true;
                errors.Add(new(
                    "article_archived",
                    $"{LineField(line.Index)}.ean13",
                    "Un Article archivé n’accepte plus d’Approvisionnement."));
            }
        }

        if (errors.Count > 0)
        {
            return archivedArticle
                ? new(BulkSupplyStatus.Conflict, null, errors)
                : unknownArticle
                    ? new(BulkSupplyStatus.NotFound, null, errors)
                    : new(BulkSupplyStatus.ValidationFailed, null, errors);
        }

        var currentPositions = (await stockReader.ListAsync(cancellationToken))
            .GroupBy(position => position.Ean13)
            .ToDictionary(group => group.Key, group => group.First());
        var commitLines = new List<BulkSupplyCommitLine>(parsedLines.Count);
        var operationLines = new List<StockOperationLine>(parsedLines.Count);
        foreach (var line in parsedLines)
        {
            var currentPosition = currentPositions.GetValueOrDefault(line.Ean13);
            StockPosition nextPosition;
            try
            {
                nextPosition = (currentPosition ?? new StockPosition(line.Ean13, 0)).Add(line.Quantity);
            }
            catch (OverflowException)
            {
                errors.Add(new(
                    "bulk_supply.quantity.overflow",
                    $"{LineField(line.Index)}.quantity",
                    "La quantité dépasse la capacité du Stock."));
                continue;
            }

            var operationLine = new StockOperationLine(
                operationLines.Count + 1,
                line.Ean13,
                line.Quantity);
            operationLines.Add(operationLine);
            commitLines.Add(new(
                articles[line.Ean13],
                currentPosition,
                nextPosition,
                operationLine));
        }

        if (errors.Count > 0)
        {
            return new(BulkSupplyStatus.ValidationFailed, null, errors);
        }

        StockOperation operation;
        try
        {
            operation = StockOperation.CreateBulkSupply(
                Guid.NewGuid().ToString("N"),
                operationLines,
                clock.UtcNow);
        }
        catch (OverflowException)
        {
            return new(
                BulkSupplyStatus.ValidationFailed,
                null,
                [new(
                    "bulk_supply.quantity.overflow",
                    "lines",
                    "La quantité totale dépasse la capacité du Stock.")]);
        }

        BulkSupplyCommitResult committed;
        try
        {
            committed = await committer.CommitAsync(
                new BulkSupplyCommitRequest(operation, commitLines),
                cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return PersistenceFailure();
        }

        if (committed.Status == BulkSupplyCommitStatus.Conflict)
        {
            return new(
                BulkSupplyStatus.Conflict,
                null,
                [new(
                    "bulk_supply.commit.conflict",
                    "lines",
                    "L’Approvisionnement n’a pas pu être engagé avec l’état courant du Stock.")]);
        }

        if (committed.Status != BulkSupplyCommitStatus.Committed
            || committed.Operation is null
            || committed.Positions is null
            || committed.Positions.Count != commitLines.Count)
        {
            return PersistenceFailure();
        }

        var positions = new StockPositionView[commitLines.Count];
        for (var index = 0; index < commitLines.Count; index++)
        {
            if (committed.Positions[index].Ean13 != commitLines[index].OperationLine.Ean13)
            {
                return PersistenceFailure();
            }

            positions[index] = StockPositionView.From(
                commitLines[index].ArticleSnapshot,
                committed.Positions[index],
                clock.WarehouseDate);
        }

        return new(
            BulkSupplyStatus.Committed,
            new BulkSupplyReceipt(committed.Operation, positions),
            []);

        BulkSupplyResult PersistenceFailure()
            => new(
                BulkSupplyStatus.PersistenceFailed,
                null,
                [new(
                    "bulk_supply.persistence_failed",
                    "lines",
                    "L’Approvisionnement en masse n’a pas pu être enregistré.")]);
    }

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
                    committedPosition,
                    clock.WarehouseDate)),
            []);
    }

    private async Task<IReadOnlyDictionary<Ean13, ArticleSellabilitySnapshot>> ReadArticlesAsync(
        IReadOnlyList<Ean13> eans,
        CancellationToken cancellationToken)
    {
        if (articleReader is IArticleSellabilityBatchReader batchReader)
        {
            return await batchReader.FindSellabilityByEansAsync(eans, cancellationToken);
        }

        var articles = new Dictionary<Ean13, ArticleSellabilitySnapshot>();
        foreach (var ean13 in eans)
        {
            var article = await articleReader.FindSellabilityByEanAsync(ean13, cancellationToken);
            if (article is not null)
            {
                articles[ean13] = article;
            }
        }

        return articles;
    }

    private static string LineField(int index) => $"lines[{index}]";
}
