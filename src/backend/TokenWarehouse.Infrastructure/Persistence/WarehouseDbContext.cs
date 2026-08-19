using Microsoft.EntityFrameworkCore;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class WarehouseDbContext(DbContextOptions<WarehouseDbContext> options) : DbContext(options)
{
}
