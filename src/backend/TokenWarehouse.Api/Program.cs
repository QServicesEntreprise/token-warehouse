using TokenWarehouse.Application;
using TokenWarehouse.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);
var connectionString = builder.Configuration.GetConnectionString("Warehouse")
    ?? "Data Source=token-warehouse.db";
builder.Services.AddSqlitePersistence(connectionString);

builder.Services.AddSingleton<RuntimeReadiness>();

var app = builder.Build();

app.MapGet("/health", async (RuntimeReadiness readiness, CancellationToken cancellationToken) =>
{
    var status = await readiness.CheckAsync(cancellationToken);
    return status.IsReady
        ? Results.Ok(new { status = "ok", provider = status.Provider })
        : Results.Problem(
            statusCode: StatusCodes.Status503ServiceUnavailable,
            title: "Persistence unavailable");
});

app.Run();

public partial class Program
{
}
