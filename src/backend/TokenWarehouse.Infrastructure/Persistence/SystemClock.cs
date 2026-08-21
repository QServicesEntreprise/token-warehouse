using TokenWarehouse.Application;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SystemClock : IClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}
