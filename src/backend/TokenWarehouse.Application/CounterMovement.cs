using TokenWarehouse.Domain;

namespace TokenWarehouse.Application;

public sealed record CounterMovementCommand
{
    public string? SourceOperationId { get; init; }

    public string? Justification { get; init; }
}

public sealed record CounterMovementCommitLinePlan(
    Ean13 Ean13,
    int ExpectedPreviousPhysicalStock,
    StockOperationLine OperationLine,
    int ExpectedPositionVersion,
    int ExpectedArticleVersion);

public sealed record CounterMovementCommitPlan
{
    public CounterMovementCommitPlan(
        StockOperation operation,
        string sourceOperationId,
        IReadOnlyList<CounterMovementCommitLinePlan> lines,
        SaleFinancialReversal? financialReversal = null)
    {
        ArgumentNullException.ThrowIfNull(operation);
        ArgumentException.ThrowIfNullOrWhiteSpace(sourceOperationId);
        ArgumentNullException.ThrowIfNull(lines);
        if (financialReversal is not null
            && financialReversal != operation.FinancialReversal)
        {
            throw new ArgumentException("The commit plan financial reversal must match the operation.", nameof(financialReversal));
        }

        if (lines.Count != operation.Lines.Count)
        {
            throw new ArgumentException("The commit plan must contain one entry per operation line.", nameof(lines));
        }

        Operation = operation;
        SourceOperationId = sourceOperationId;
        Lines = Array.AsReadOnly(lines.ToArray());
        FinancialReversal = financialReversal ?? operation.FinancialReversal;
    }

    public StockOperation Operation { get; }

    public string SourceOperationId { get; }

    public IReadOnlyList<CounterMovementCommitLinePlan> Lines { get; }

    public SaleFinancialReversal? FinancialReversal { get; }
}

public sealed record CounterMovementLineReceipt(
    StockOperationLine Operation,
    int SourceEffect,
    int InverseEffect,
    StockPositionView Position);

public sealed record CounterMovementReceipt(
    StockOperation CounterMovement,
    StockOperation Source,
    IReadOnlyList<CounterMovementLineReceipt> Lines,
    IReadOnlyList<StockPositionView> Positions,
    SaleFinancialReversal? FinancialReversal = null);

public sealed record CorrectableStockOperationSummary(
    string Id,
    string Type,
    DateTimeOffset TimestampUtc,
    string Ean13,
    IReadOnlyList<CorrectableStockOperationLineSummary> Lines,
    SaleFinancialSnapshot? Financial = null);

public sealed record CorrectableStockOperationLineSummary(
    int LineNumber,
    string Ean13,
    int StockEffect);

public enum CounterMovementRegistrationStatus
{
    Committed,
    ValidationFailed,
    SourceNotFound,
    SourceAlreadyCorrected,
    SourceIsCounterMovement,
    SourceTypeUnsupported,
    SaleFinancialSnapshotInvalid,
    ResultingStockNegative,
    Conflict,
    PersistenceFailed
}

public sealed record CounterMovementRegistrationResult(
    CounterMovementRegistrationStatus Status,
    CounterMovementReceipt? Receipt,
    IReadOnlyList<ArticleValidationError> Errors);

public enum CorrectableStockOperationReadStatus
{
    Success,
    PersistenceFailed
}

public sealed record CorrectableStockOperationReadResult(
    CorrectableStockOperationReadStatus Status,
    IReadOnlyList<CorrectableStockOperationSummary> Sources);

public interface IRegisterCounterMovementUseCase
{
    Task<CounterMovementRegistrationResult> CorrectAsync(
        CounterMovementCommand command,
        CancellationToken cancellationToken = default);
}

public interface IReadCorrectableStockOperationsUseCase
{
    Task<CorrectableStockOperationReadResult> ListAsync(
        CancellationToken cancellationToken = default);
}

public sealed class CounterMovementApplication(
    IArticleSellabilityReader articleReader,
    IStockPositionReader positionReader,
    IStockMutationCommitter committer,
    IStockOperationReader operationReader,
    IClock clock,
    ISaleReader? saleReader = null) : IRegisterCounterMovementUseCase, IReadCorrectableStockOperationsUseCase
{
    public async Task<CounterMovementRegistrationResult> CorrectAsync(
        CounterMovementCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);

        var errors = new List<ArticleValidationError>();
        if (string.IsNullOrWhiteSpace(command.SourceOperationId))
        {
            errors.Add(new(
                "INVALID_INPUT",
                "sourceOperationId",
                "L’identifiant de l’Opération source est requis."));
        }

        if (!Justification.TryCreate(command.Justification, out var justification))
        {
            errors.Add(new(
                "INVALID_INPUT",
                "justification",
                "La justification est obligatoire et ne peut pas être vide."));
        }

        if (errors.Count > 0)
        {
            return new(CounterMovementRegistrationStatus.ValidationFailed, null, errors);
        }

        try
        {
            var sourceId = command.SourceOperationId!.Trim();
            var source = await operationReader.FindByIdAsync(sourceId, cancellationToken);
            if (source is null)
            {
                return Failure(
                    CounterMovementRegistrationStatus.SourceNotFound,
                    "SOURCE_OPERATION_NOT_FOUND",
                    "sourceOperationId",
                    "L’Opération source est introuvable.");
            }

            if (source.Type == StockOperationType.CounterMovement)
            {
                return Failure(
                    CounterMovementRegistrationStatus.SourceIsCounterMovement,
                    "SOURCE_IS_COUNTER_MOVEMENT",
                    "sourceOperationId",
                    "Un Contre-mouvement ne peut pas être corrigé.");
            }

            if (source.Type is not (StockOperationType.Supply
                or StockOperationType.Inventory
                or StockOperationType.Sale))
            {
                return Failure(
                    CounterMovementRegistrationStatus.SourceTypeUnsupported,
                    "SOURCE_TYPE_UNSUPPORTED",
                    "sourceOperationId",
                    "Le type de l’Opération source ne peut pas être corrigé.");
            }

            if (source.TimestampUtc > clock.UtcNow)
            {
                return Failure(
                    CounterMovementRegistrationStatus.Conflict,
                    "POSITION_CONFLICT",
                    "sourceOperationId",
                    "L’Opération source doit être antérieure à la correction.");
            }

            if (await operationReader.FindCounterMovementBySourceIdAsync(source.Id, cancellationToken) is not null)
            {
                return Failure(
                    CounterMovementRegistrationStatus.SourceAlreadyCorrected,
                    "SOURCE_ALREADY_CORRECTED",
                    "sourceOperationId",
                    "Cette Opération source a déjà été corrigée.");
            }

            SaleFinancialReversal? financialReversal = null;
            if (source.Type == StockOperationType.Sale)
            {
                SaleReadRecord? sale;
                try
                {
                    sale = saleReader is null
                        ? null
                        : await saleReader.FindByOperationIdAsync(source.Id, cancellationToken);
                }
                catch (InvalidOperationException)
                {
                    return Failure(
                        CounterMovementRegistrationStatus.SaleFinancialSnapshotInvalid,
                        "SALE_FINANCIAL_SNAPSHOT_INVALID",
                        "sourceOperationId",
                        "Le snapshot financier historique de la Vente est introuvable ou incohérent.");
                }

                if (sale is null
                    || sale.Operation.Id != source.Id
                    || sale.Operation.Type != StockOperationType.Sale)
                {
                    return Failure(
                        CounterMovementRegistrationStatus.SaleFinancialSnapshotInvalid,
                        "SALE_FINANCIAL_SNAPSHOT_INVALID",
                        "sourceOperationId",
                        "Le snapshot financier historique de la Vente est introuvable ou incohérent.");
                }

                try
                {
                    financialReversal = SaleFinancialReversalPolicy.Create(source.Id, sale.Financial);
                }
                catch (ArgumentException)
                {
                    return Failure(
                        CounterMovementRegistrationStatus.SaleFinancialSnapshotInvalid,
                        "SALE_FINANCIAL_SNAPSHOT_INVALID",
                        "sourceOperationId",
                        "Le snapshot financier historique de la Vente est invalide.");
                }
            }

            var eans = source.Lines.Select(line => line.Ean13).ToArray();
            var positions = await positionReader.FindByEansAsync(eans, cancellationToken);
            var policyPlan = CounterMovementPolicy.CreatePlan(source, positions);
            var articles = (await articleReader.FindManyAsync(eans, cancellationToken))
                .ToDictionary(article => article.Ean13);
            if (articles.Count != eans.Distinct().Count())
            {
                return Failure(
                    CounterMovementRegistrationStatus.Conflict,
                    "POSITION_CONFLICT",
                    "sourceOperationId",
                    "L’Article d’une Opération source n’est plus disponible.");
            }

            var counterMovement = StockOperation.CreateCounterMovement(
                Guid.NewGuid().ToString("N"),
                source.Id,
                source.Type,
                justification.Value,
                policyPlan.Lines,
                clock.UtcNow,
                financialReversal);
            var commitPlan = new CounterMovementCommitPlan(
                counterMovement,
                source.Id,
                policyPlan.Lines
                    .Select((line, index) => new CounterMovementCommitLinePlan(
                        line.Ean13,
                        line.CurrentPhysicalStock,
                        counterMovement.Lines[index],
                        line.CurrentPositionVersion,
                        articles[line.Ean13].Version))
                    .ToArray(),
                financialReversal);
            var commit = await committer.CommitAsync(commitPlan, cancellationToken);

            return commit.Status switch
            {
                StockMutationCommitStatus.Committed
                    when commit.Positions.Count == policyPlan.Lines.Count
                    => Committed(counterMovement, source, policyPlan, commit.Positions, articles, clock.WarehouseDate),
                StockMutationCommitStatus.Conflict
                    => Failure(
                        CounterMovementRegistrationStatus.Conflict,
                        "POSITION_CONFLICT",
                        "sourceOperationId",
                        "La position Stock ou la source a changé pendant la correction."),
                _ => Failure(
                    CounterMovementRegistrationStatus.PersistenceFailed,
                    "PERSISTENCE_FAILURE",
                    "sourceOperationId",
                    "Le Contre-mouvement n’a pas pu être enregistré.")
            };
        }
        catch (CounterMovementNegativeStockException exception)
        {
            return Failure(
                CounterMovementRegistrationStatus.ResultingStockNegative,
                "RESULTING_STOCK_NEGATIVE",
                "sourceOperationId",
                $"La correction rendrait le Stock physique négatif pour {exception.Ean13.Value}.");
        }
        catch (CounterMovementUnsupportedSourceException)
        {
            return Failure(
                CounterMovementRegistrationStatus.SourceTypeUnsupported,
                "SOURCE_TYPE_UNSUPPORTED",
                "sourceOperationId",
                "Le type de l’Opération source ne peut pas être corrigé.");
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return Failure(
                CounterMovementRegistrationStatus.PersistenceFailed,
                "PERSISTENCE_FAILURE",
                "sourceOperationId",
                "Le Contre-mouvement n’a pas pu être enregistré.");
        }
    }

    public async Task<CorrectableStockOperationReadResult> ListAsync(
        CancellationToken cancellationToken = default)
    {
        try
        {
            var sources = await operationReader.ListCorrectableAsync(cancellationToken);
            var summaries = new List<CorrectableStockOperationSummary>(sources.Count);
            foreach (var source in sources)
            {
                if (source.TimestampUtc > clock.UtcNow)
                {
                    continue;
                }

                SaleFinancialSnapshot? financial = null;
                if (source.Type == StockOperationType.Sale)
                {
                    SaleReadRecord? sale;
                    try
                    {
                        sale = saleReader is null
                            ? null
                            : await saleReader.FindByOperationIdAsync(source.Id, cancellationToken);
                    }
                    catch (InvalidOperationException)
                    {
                        continue;
                    }

                    if (sale is null
                        || sale.Operation.Id != source.Id
                        || sale.Operation.Type != StockOperationType.Sale)
                    {
                        continue;
                    }

                    financial = sale.Financial;
                }

                summaries.Add(new(
                    source.Id,
                    source.Type.ToString().ToUpperInvariant(),
                    source.TimestampUtc,
                    source.Ean13.Value,
                    source.Lines.Select(line => new CorrectableStockOperationLineSummary(
                        line.LineNumber,
                        line.Ean13.Value,
                        line.StockEffect)).ToArray(),
                    financial));
            }

            return new(
                CorrectableStockOperationReadStatus.Success,
                summaries);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return new(CorrectableStockOperationReadStatus.PersistenceFailed, []);
        }
    }

    private static CounterMovementRegistrationResult Committed(
        StockOperation counterMovement,
        StockOperation source,
        CounterMovementPlan policyPlan,
        IReadOnlyList<StockPosition> positions,
        IReadOnlyDictionary<Ean13, ArticleSellabilitySnapshot> articles,
        DateOnly warehouseDate)
    {
        var committedByEan = positions.ToDictionary(position => position.Ean13);
        var lines = policyPlan.Lines
            .Select((line, index) => new CounterMovementLineReceipt(
                counterMovement.Lines[index],
                line.SourceEffect,
                line.InverseEffect,
                StockPositionView.From(
                    articles[line.Ean13],
                    committedByEan[line.Ean13],
                    warehouseDate)))
            .ToArray();
        return new(
            CounterMovementRegistrationStatus.Committed,
            new(
                counterMovement,
                source,
                lines,
                lines.Select(line => line.Position).ToArray(),
                counterMovement.FinancialReversal),
            []);
    }

    private static CounterMovementRegistrationResult Failure(
        CounterMovementRegistrationStatus status,
        string code,
        string field,
        string message)
        => new(status, null, [new(code, field, message)]);
}
