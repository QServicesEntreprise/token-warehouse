using System.Globalization;
using TokenWarehouse.Application;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SystemClock(TimeZoneInfo warehouseTimeZone) : IClock
{
    private readonly TimeZoneInfo warehouseTimeZone = warehouseTimeZone;

    public DateTimeOffset UtcNow
        => DateTimeOffset.TryParse(
            Environment.GetEnvironmentVariable("TOKEN_WAREHOUSE_UTC_NOW"),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var configuredUtcNow)
            ? configuredUtcNow
            : DateTimeOffset.UtcNow;

    public DateOnly WarehouseDate
        => DateOnly.TryParse(
            Environment.GetEnvironmentVariable("TOKEN_WAREHOUSE_WAREHOUSE_DATE"),
            out var configuredDate)
            ? configuredDate
            : DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(UtcNow, warehouseTimeZone).DateTime);
}
