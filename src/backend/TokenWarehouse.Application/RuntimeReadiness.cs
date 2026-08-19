namespace TokenWarehouse.Application;

public interface IPersistenceAdapter
{
    string Provider { get; }

    ValueTask<PersistenceStatus> CheckAsync(CancellationToken cancellationToken = default);
}

public sealed record PersistenceStatus(bool IsReady, string Provider);

public sealed class RuntimeReadiness(IPersistenceAdapter persistence)
{
    public ValueTask<PersistenceStatus> CheckAsync(CancellationToken cancellationToken = default)
        => persistence.CheckAsync(cancellationToken);
}
