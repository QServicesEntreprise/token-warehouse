using System.Reflection;
using TokenWarehouse.Domain;
using Xunit;

namespace TokenWarehouse.Domain.Tests;

public sealed class DependencyTests
{
    [Fact]
    public void Domain_does_not_reference_runtime_adapters()
    {
        var forbiddenPrefixes = new[]
        {
            "Microsoft.AspNetCore",
            "Microsoft.EntityFrameworkCore",
            "Microsoft.Data.Sqlite",
            "System.Net.Http"
        };

        var references = typeof(AssemblyMarker).Assembly
            .GetReferencedAssemblies()
            .Select(reference => reference.Name ?? string.Empty);

        Assert.DoesNotContain(references, name => forbiddenPrefixes.Any(name.StartsWith));
    }
}
