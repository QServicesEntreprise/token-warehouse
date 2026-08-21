using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TokenWarehouse.Application;

namespace TokenWarehouse.Infrastructure.Persistence;

public static class SqlitePersistenceRegistration
{
    public static IServiceCollection AddSqlitePersistence(this IServiceCollection services, string connectionString)
    {
        services.AddDbContextFactory<WarehouseDbContext>(options => options.UseSqlite(connectionString));
        services.AddSingleton<IPersistenceAdapter, SqlitePersistenceAdapter>();
        services.AddScoped<IArticleStore, SqliteArticleStore>();
        services.AddScoped<IArticleSellabilityReader, SqliteArticleSellabilityReader>();
        services.AddScoped<IStockReadReader, SqliteStockReadReader>();
        services.AddScoped<IStockPositionReader, SqliteStockPositionReader>();
        services.AddScoped<ISupplyCommitter, SqliteSupplyCommitter>();
        services.AddHostedService<SqliteMigrationHostedService>();
        return services;
    }
}
