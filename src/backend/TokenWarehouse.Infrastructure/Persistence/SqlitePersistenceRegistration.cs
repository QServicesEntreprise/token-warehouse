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
        services.AddScoped<SqliteArticleStore>();
        services.AddScoped<IArticleStore>(services => services.GetRequiredService<SqliteArticleStore>());
        services.AddScoped<IArticleSellabilityReader>(services => services.GetRequiredService<SqliteArticleStore>());
        services.AddScoped<IStockReadReader, SqliteStockReadReader>();
        services.AddScoped<IStockPositionReader, SqliteStockPositionReader>();
        services.AddScoped<IStockMutationCommitter, SqliteStockMutationCommitter>();
        services.AddScoped<IStockOperationReader, SqliteStockOperationReader>();
        services.AddHostedService<SqliteMigrationHostedService>();
        return services;
    }
}
