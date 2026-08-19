using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class WarehouseDbContextFactory : IDesignTimeDbContextFactory<WarehouseDbContext>
{
    public WarehouseDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<WarehouseDbContext>()
            .UseSqlite("Data Source=token-warehouse.db")
            .Options;

        return new WarehouseDbContext(options);
    }
}
