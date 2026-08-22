namespace TokenWarehouse.Domain;

public readonly record struct Justification
{
    private Justification(string value) => Value = value;

    public string Value { get; }

    public static bool TryCreate(string? value, out Justification justification)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            justification = default;
            return false;
        }

        justification = new(normalized);
        return true;
    }
}

public sealed record CounterMovementLinePlan(
    Ean13 Ean13,
    int SourceEffect,
    int InverseEffect,
    int CurrentPhysicalStock,
    int ResultingPhysicalStock,
    int CurrentPositionVersion);

public sealed record CounterMovementPlan(IReadOnlyList<CounterMovementLinePlan> Lines)
{
    public IReadOnlyList<StockPosition> ResultingPositions
        => Lines
            .Select(line => new StockPosition(
                line.Ean13,
                line.ResultingPhysicalStock,
                line.CurrentPositionVersion + 1))
            .ToArray();
}

public sealed class CounterMovementNegativeStockException(
    Ean13 ean13,
    int resultingPhysicalStock)
    : InvalidOperationException(
        $"The counter-movement would make {ean13.Value} negative ({resultingPhysicalStock}).")
{
    public Ean13 Ean13 { get; } = ean13;

    public int ResultingPhysicalStock { get; } = resultingPhysicalStock;
}

public sealed class CounterMovementUnsupportedSourceException(StockOperationType type)
    : InvalidOperationException($"A {type} operation cannot be corrected by this counter-movement.")
{
    public StockOperationType Type { get; } = type;
}

public static class CounterMovementPolicy
{
    public static CounterMovementPlan CreatePlan(
        StockOperation source,
        IReadOnlyList<StockPosition> currentPositions)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(currentPositions);
        if (source.Type is not (StockOperationType.Supply
            or StockOperationType.Inventory
            or StockOperationType.Sale))
        {
            throw new CounterMovementUnsupportedSourceException(source.Type);
        }

        var positions = currentPositions.ToDictionary(position => position.Ean13);
        var lines = new List<CounterMovementLinePlan>(source.Lines.Count);
        foreach (var line in source.Lines)
        {
            var current = positions.GetValueOrDefault(line.Ean13);
            var sourceEffect = line.StockEffect;
            var inverseEffect = checked(-sourceEffect);
            var currentPhysicalStock = current?.PhysicalQuantity ?? 0;
            var resultingPhysicalStock = (long)currentPhysicalStock + inverseEffect;
            if (resultingPhysicalStock < 0 || resultingPhysicalStock > int.MaxValue)
            {
                throw new CounterMovementNegativeStockException(
                    line.Ean13,
                    resultingPhysicalStock < 0 ? (int)resultingPhysicalStock : int.MaxValue);
            }

            lines.Add(new(
                line.Ean13,
                sourceEffect,
                inverseEffect,
                currentPhysicalStock,
                (int)resultingPhysicalStock,
                current?.Version ?? 0));
        }

        return new(Array.AsReadOnly(lines.ToArray()));
    }

    public static CounterMovementPlan Plan(
        StockOperation source,
        IReadOnlyList<StockPosition> currentPositions)
        => CreatePlan(source, currentPositions);
}
