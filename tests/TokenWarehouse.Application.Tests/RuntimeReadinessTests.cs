using TokenWarehouse.Application;
using Xunit;

namespace TokenWarehouse.Application.Tests;

public sealed class RuntimeReadinessTests
{
    [Fact]
    public async Task Readiness_uses_the_application_persistence_port()
    {
        var fake = new FakePersistenceAdapter();
        var readiness = new RuntimeReadiness(fake);

        var result = await readiness.CheckAsync();

        Assert.True(result.IsReady);
        Assert.Equal("fake", result.Provider);
        Assert.Equal(1, fake.Calls);
    }

    private sealed class FakePersistenceAdapter : IPersistenceAdapter
    {
        public string Provider => "fake";

        public int Calls { get; private set; }

        public ValueTask<PersistenceStatus> CheckAsync(CancellationToken cancellationToken = default)
        {
            Calls++;
            return ValueTask.FromResult(new PersistenceStatus(true, "fake"));
        }
    }
}
