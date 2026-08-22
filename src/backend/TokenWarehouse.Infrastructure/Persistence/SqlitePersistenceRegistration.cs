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
        services.AddScoped<IArticleSellabilityReader, SqliteArticleSellabilityReader>();
        services.AddScoped<IArticleSellabilityBatchReader>(services =>
            (IArticleSellabilityBatchReader)services.GetRequiredService<IArticleSellabilityReader>());
        services.AddScoped<SqliteStockReadReader>();
        services.AddScoped<IStockReadReader>(services =>
            services.GetRequiredService<SqliteStockReadReader>());
        services.AddScoped<ICurrentDashboardReadSource, SqliteCurrentDashboardReadSource>();
        services.AddScoped<IStockPositionReader, SqliteStockPositionReader>();
        services.AddScoped<SqliteSupplyCommitter>();
        services.AddScoped<ISupplyCommitter>(services =>
            services.GetRequiredService<SqliteSupplyCommitter>());
        services.AddScoped<SqliteStockMutationCommitter>();
        services.AddScoped<IStockMutationCommitter>(services =>
            services.GetRequiredService<SqliteStockMutationCommitter>());
        services.AddScoped<SqliteStockOperationReader>();
        services.AddScoped<IStockOperationReader>(services =>
            services.GetRequiredService<SqliteStockOperationReader>());
        services.AddScoped<ISaleReader, SqliteSaleReader>();
        services.AddScoped<SqliteHistoryReader>();
        services.AddScoped<IHistoryReader>(services => services.GetRequiredService<SqliteHistoryReader>());
        services.AddHostedService<SqliteMigrationHostedService>();
        return services;
    }
}
