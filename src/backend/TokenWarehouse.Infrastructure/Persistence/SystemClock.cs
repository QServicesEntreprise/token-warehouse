using TokenWarehouse.Application;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SystemClock : IClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;

    public DateOnly WarehouseDate
        => DateOnly.TryParse(
            Environment.GetEnvironmentVariable("TOKEN_WAREHOUSE_WAREHOUSE_DATE"),
            out var configuredDate)
            ? configuredDate
            : DateOnly.FromDateTime(DateTime.Now);
}
