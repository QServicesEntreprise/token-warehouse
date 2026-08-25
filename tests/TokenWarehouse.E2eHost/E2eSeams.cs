using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using TokenWarehouse.Application;
using TokenWarehouse.Infrastructure.Persistence;

namespace TokenWarehouse.E2eHost;

public static class E2eSeamsRegistration
{
    public static void AddE2eSeams(this WebApplicationBuilder builder)
    {
        if (!builder.Environment.IsEnvironment("Testing"))
        {
            return;
        }

        if (string.Equals(
                Environment.GetEnvironmentVariable("TOKEN_WAREHOUSE_HISTORY_FAILURE"),
                "true",
                StringComparison.OrdinalIgnoreCase))
        {
            builder.Services.AddScoped<IHistoryReader>(services =>
                new FailingHistoryReader(services.GetRequiredService<SqliteHistoryReader>()));
        }

        var saleCommitGateDirectory = Environment.GetEnvironmentVariable("TOKEN_WAREHOUSE_SALE_COMMIT_GATE");
        if (!string.IsNullOrWhiteSpace(saleCommitGateDirectory))
        {
            builder.Services.AddScoped<IStockMutationCommitter>(services =>
                new E2eSaleCommitGate(
                    services.GetRequiredService<SqliteStockMutationCommitter>(),
                    saleCommitGateDirectory));
        }

        builder.Services.AddHostedService<E2eSeeder>();
    }
}

file sealed class FailingHistoryReader(SqliteHistoryReader inner) : IHistoryReader
{
    public async ValueTask<HistoryReadResult> ReadAsync(
        HistoryQuery query,
        CancellationToken cancellationToken = default)
    {
        await inner.ReadAsync(query, cancellationToken);
        throw new InvalidOperationException("controlled history failure");
    }
}

file sealed class E2eSaleCommitGate(
    IStockMutationCommitter inner,
    string gateDirectory) : IStockMutationCommitter
{
    public ValueTask<StockMutationCommitResult> CommitAsync(
        InventoryCommitPlan plan,
        CancellationToken cancellationToken = default)
        => inner.CommitAsync(plan, cancellationToken);

    public ValueTask<StockMutationCommitResult> CommitAsync(
        CounterMovementCommitPlan plan,
        CancellationToken cancellationToken = default)
        => inner.CommitAsync(plan, cancellationToken);

    public async ValueTask<StockMutationCommitResult> CommitAsync(
        StockSaleCommitPlan plan,
        CancellationToken cancellationToken = default)
    {
        await WaitForReleaseAsync(cancellationToken);
        return await inner.CommitAsync(plan, cancellationToken);
    }

    public async ValueTask<StockMutationCommitResult> CommitAsync(
        StockSaleCommitPlan plan,
        IStockSaleCommitParticipant participant,
        CancellationToken cancellationToken = default)
    {
        await WaitForReleaseAsync(cancellationToken);
        return await inner.CommitAsync(plan, participant, cancellationToken);
    }

    private async Task WaitForReleaseAsync(CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(gateDirectory);
        await File.WriteAllTextAsync(
            Path.Combine(gateDirectory, "validated"),
            string.Empty,
            cancellationToken);
        var releasePath = Path.Combine(gateDirectory, "release");
        while (!File.Exists(releasePath))
        {
            await Task.Delay(25, cancellationToken);
        }
    }
}
