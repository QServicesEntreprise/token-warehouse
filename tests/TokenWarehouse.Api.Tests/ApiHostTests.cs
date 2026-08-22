using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TokenWarehouse.Application;
using Xunit;

namespace TokenWarehouse.Api.Tests;

public sealed class ApiHostTests
{
    [Fact]
    public async Task Real_host_composition_serves_health_from_sqlite()
    {
        using var factory = new RealHostFactory();
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/health");
        response.EnsureSuccessStatusCode();
        using var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

        Assert.Equal("ok", payload.RootElement.GetProperty("status").GetString());
        Assert.Equal("sqlite", payload.RootElement.GetProperty("provider").GetString());
    }

    [Fact]
    public async Task Test_composition_replaces_persistence_without_starting_sqlite()
    {
        var fake = new FakePersistenceAdapter();
        using var factory = new FakeHostFactory(fake);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/health");
        response.EnsureSuccessStatusCode();
        using var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

        Assert.Equal("fake", payload.RootElement.GetProperty("provider").GetString());
        Assert.Equal(1, fake.Calls);
    }

    [Fact]
    public async Task Unready_persistence_returns_problem_details()
    {
        using var factory = new FakeHostFactory(new FakePersistenceAdapter(false));
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Health_exposes_one_configured_warehouse_date_and_current_month()
    {
        var instant = new DateTimeOffset(2030, 3, 31, 23, 30, 0, TimeSpan.Zero);
        var warehouseTimeZone = TimeZoneInfo.CreateCustomTimeZone(
            "Warehouse",
            TimeSpan.FromHours(2),
            "Warehouse",
            "Warehouse");
        using var factory = new CalendarBoundaryHostFactory(instant, warehouseTimeZone);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/health");
        response.EnsureSuccessStatusCode();
        using var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var currentMonth = payload.RootElement.GetProperty("currentMonth");

        Assert.Equal("2030-04-01", payload.RootElement.GetProperty("warehouseDate").GetString());
        Assert.Equal("2030-04-01", currentMonth.GetProperty("from").GetString());
        Assert.Equal("2030-04-30", currentMonth.GetProperty("to").GetString());
    }

    private sealed class RealHostFactory : WebApplicationFactory<Program>
    {
        private readonly string databasePath = Path.Combine(Path.GetTempPath(), $"token-warehouse-{Guid.NewGuid():N}.db");

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:Warehouse", $"Data Source={databasePath}");
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (disposing)
            {
                File.Delete(databasePath);
            }
        }
    }

    private sealed class FakeHostFactory(FakePersistenceAdapter fake) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IPersistenceAdapter>();
                services.AddSingleton<IPersistenceAdapter>(fake);
            });
        }
    }

    private sealed class CalendarBoundaryHostFactory(
        DateTimeOffset instant,
        TimeZoneInfo warehouseTimeZone) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IClock>();
                services.RemoveAll<TimeZoneInfo>();
                services.RemoveAll<IPersistenceAdapter>();
                services.AddSingleton<IClock>(new FixedClock(instant));
                services.AddSingleton(warehouseTimeZone);
                services.AddSingleton<IPersistenceAdapter>(new FakePersistenceAdapter());
            });
        }
    }

    private sealed class FixedClock(DateTimeOffset instant) : IClock
    {
        public DateTimeOffset UtcNow => instant;
    }

    private sealed class FakePersistenceAdapter(bool ready = true) : IPersistenceAdapter
    {
        public string Provider => "fake";

        public int Calls { get; private set; }

        public ValueTask<PersistenceStatus> CheckAsync(CancellationToken cancellationToken = default)
        {
            Calls++;
            return ValueTask.FromResult(new PersistenceStatus(ready, "fake"));
        }
    }
}
