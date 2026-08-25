using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TokenWarehouse.Application;
using TokenWarehouse.Infrastructure.Persistence;

namespace TokenWarehouse.Api;

public static class WarehouseHost
{
    public static WebApplication Build(
        string[] args,
        Action<WebApplicationBuilder>? configure = null)
    {
        var builder = WebApplication.CreateBuilder(args);
        builder.Services.ConfigureHttpJsonOptions(options =>
            options.SerializerOptions.NumberHandling = JsonNumberHandling.Strict);

        var warehouseTimeZone = TimeZoneInfo.FindSystemTimeZoneById(
            builder.Configuration["Warehouse:TimeZoneId"] ?? TimeZoneInfo.Utc.Id);
        builder.Services.AddSingleton(warehouseTimeZone);

        var connectionString = builder.Configuration.GetConnectionString("Warehouse")
            ?? "Data Source=token-warehouse.db";
        builder.Services.AddSqlitePersistence(connectionString);
        builder.Services.AddScoped<ArticleApplication>();
        builder.Services.AddScoped<StockApplication>();
        builder.Services.AddScoped<DashboardApplication>();
        builder.Services.AddScoped<InventoryApplication>();
        builder.Services.AddScoped<IReadStockUseCase>(services => services.GetRequiredService<StockApplication>());
        builder.Services.AddScoped<IStockPositionReadContract>(services => services.GetRequiredService<StockApplication>());
        builder.Services.AddScoped<IReadCurrentDashboardUseCase>(services =>
            services.GetRequiredService<DashboardApplication>());
        builder.Services.AddScoped<StockOperationReadApplication>();
        builder.Services.AddScoped<IStockOperationReadContract>(services =>
            services.GetRequiredService<StockOperationReadApplication>());
        builder.Services.AddScoped<StockSaleApplication>();
        builder.Services.AddScoped<IStockSaleContract>(services =>
            services.GetRequiredService<StockSaleApplication>());
        builder.Services.AddScoped<IArticleSaleReader, ArticleSaleReader>();
        builder.Services.AddScoped<SaleApplication>();
        builder.Services.AddScoped<ISaleContract>(services =>
            services.GetRequiredService<SaleApplication>());
        builder.Services.AddScoped<SupplyApplication>();
        builder.Services.AddScoped<SupplyReadApplication>();
        builder.Services.AddScoped<IRecordSupplyUseCase>(services => services.GetRequiredService<SupplyApplication>());
        builder.Services.AddScoped<IRecordBulkSupplyUseCase>(services => services.GetRequiredService<SupplyApplication>());
        builder.Services.AddScoped<IReadSupplyUseCase>(services => services.GetRequiredService<SupplyReadApplication>());
        builder.Services.AddScoped<IRegisterInventoryUseCase>(services => services.GetRequiredService<InventoryApplication>());
        builder.Services.AddScoped<IRegisterBulkInventoryUseCase>(services => services.GetRequiredService<InventoryApplication>());
        builder.Services.AddScoped<IReadInventoryUseCase>(services => services.GetRequiredService<InventoryApplication>());
        builder.Services.AddScoped<CounterMovementApplication>();
        builder.Services.AddScoped<IRegisterCounterMovementUseCase>(services =>
            services.GetRequiredService<CounterMovementApplication>());
        builder.Services.AddScoped<IReadCorrectableStockOperationsUseCase>(services =>
            services.GetRequiredService<CounterMovementApplication>());
        builder.Services.AddScoped<ICreateArticleUseCase>(services => services.GetRequiredService<ArticleApplication>());
        builder.Services.AddScoped<IGetArticleUseCase>(services => services.GetRequiredService<ArticleApplication>());
        builder.Services.AddScoped<IListArticlesUseCase>(services => services.GetRequiredService<ArticleApplication>());
        builder.Services.AddScoped<IUpdateArticlePriceUseCase>(services => services.GetRequiredService<ArticleApplication>());
        builder.Services.AddScoped<IUpdateArticleAttributesUseCase>(services => services.GetRequiredService<ArticleApplication>());
        builder.Services.AddSingleton<IClock, SystemClock>();
        builder.Services.AddSingleton<IWarehouseCalendar, WarehouseCalendar>();
        builder.Services.AddScoped<IChangeArticleLifecycleUseCase>(services => services.GetRequiredService<ArticleApplication>());
        builder.Services.AddScoped<IGetArticleHistoryUseCase>(services => services.GetRequiredService<ArticleApplication>());
        builder.Services.AddScoped<HistoryApplication>();
        builder.Services.AddScoped<IReadHistoryUseCase>(services => services.GetRequiredService<HistoryApplication>());
        builder.Services.AddScoped<FinancialSummaryApplication>();
        builder.Services.AddScoped<IReadFinancialSummaryUseCase>(services =>
            services.GetRequiredService<FinancialSummaryApplication>());

        builder.Services.AddSingleton<RuntimeReadiness>();

        configure?.Invoke(builder);

        var app = builder.Build();

        app.UseExceptionHandler(errorApp => errorApp.Run(async context =>
        {
            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            context.Response.ContentType = "application/problem+json";
            await context.Response.WriteAsync(
                JsonSerializer.Serialize(
                    new
                    {
                        type = "https://httpstatuses.com/500",
                        title = "Une erreur interne est survenue.",
                        status = StatusCodes.Status500InternalServerError,
                        code = "INTERNAL_ERROR"
                    }),
                context.RequestAborted);
        }));

        app.MapGet("/health", async (
            RuntimeReadiness readiness,
            IWarehouseCalendar calendar,
            CancellationToken cancellationToken) =>
        {
            var status = await readiness.CheckAsync(cancellationToken);
            return status.IsReady
                ? Results.Ok(new
                {
                    status = "ok",
                    provider = status.Provider,
                    warehouseDate = calendar.WarehouseDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    currentMonth = new
                    {
                        from = calendar.CurrentMonth.From.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                        to = calendar.CurrentMonth.To.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
                    }
                })
                : Results.Problem(
                    statusCode: StatusCodes.Status503ServiceUnavailable,
                    title: "Persistence unavailable");
        });

        app.MapArticleEndpoints();
        app.MapStockEndpoints();
        app.MapDashboardEndpoints();
        app.MapSupplyEndpoints();
        app.MapInventoryEndpoints();
        app.MapCounterMovementEndpoints();
        app.MapHistoryEndpoints();
        app.MapSaleEndpoints();

        return app;
    }
}
