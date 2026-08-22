using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace TokenWarehouse.Api.Tests;

public sealed class DashboardFinancialApiTests
{
    [Fact]
    public async Task Exposes_signed_financial_totals_and_applies_dashboard_dimensions()
    {
        using var factory = new HostFactory();
        using var client = factory.CreateClient();
        var calendar = await client.GetFromJsonAsync<CalendarResponse>("/health");

        await CreateFoodArticleAsync(client, "0123456789012", "À emporter", "takeaway");
        await CreateFoodArticleAsync(client, "1234567890128", "Sur place", "onsite");
        await CreateNonFoodArticleAsync(client, "2345678901234", "Non alimentaire");
        foreach (var ean13 in new[] { "0123456789012", "1234567890128", "2345678901234" })
        {
            using var supply = await client.PostAsJsonAsync(
                "/api/supplies",
                new { ean13, quantity = 1 });
            Assert.Equal(HttpStatusCode.Created, supply.StatusCode);
        }

        var operationIds = new string[3];
        foreach (var (ean13, index) in new[]
        {
            (Ean13: "0123456789012", Index: 0),
            (Ean13: "1234567890128", Index: 1),
            (Ean13: "2345678901234", Index: 2)
        })
        {
            using var sale = await client.PostAsJsonAsync(
                "/api/sales",
                new { ean13, quantity = 1 });
            Assert.Equal(HttpStatusCode.Created, sale.StatusCode);
            using var body = JsonDocument.Parse(await sale.Content.ReadAsStringAsync());
            operationIds[index] = body.RootElement.GetProperty("operation").GetProperty("id").GetString()!;
        }

        using var counter = await client.PostAsJsonAsync(
            "/api/stock/counter-movements",
            new { sourceOperationId = operationIds[1], justification = "Correction de test" });
        Assert.Equal(HttpStatusCode.Created, counter.StatusCode);

        var dashboard = await client.GetAsync(
            $"/api/dashboard?from={calendar!.CurrentMonth.From}&to={calendar.CurrentMonth.To}");
        Assert.Equal(HttpStatusCode.OK, dashboard.StatusCode);
        using var payload = JsonDocument.Parse(await dashboard.Content.ReadAsStringAsync());
        var financial = payload.RootElement.GetProperty("financial");

        Assert.Equal(2000, financial.GetProperty("revenueHtCents").GetInt32());
        Assert.Equal(255, financial.GetProperty("vatCollectedCents").GetInt32());
        Assert.Equal(2255, financial.GetProperty("revenueTtcCents").GetInt32());
        Assert.Equal(
            new[] { ("takeaway", 1000, 55, 1055), ("onsite", 0, 0, 0), ("nonFood", 1000, 200, 1200) },
            financial.GetProperty("byTaxRate")
                .EnumerateArray()
                .Select(line => (
                    line.GetProperty("taxRate").GetProperty("code").GetString()!,
                    line.GetProperty("amountHtCents").GetInt32(),
                    line.GetProperty("vatCents").GetInt32(),
                    line.GetProperty("amountTtcCents").GetInt32()))
                .ToArray());

        var filtered = await client.GetAsync(
            $"/api/dashboard?from={calendar.CurrentMonth.From}&to={calendar.CurrentMonth.To}&type=food&mode=onsite");
        Assert.Equal(HttpStatusCode.OK, filtered.StatusCode);
        using var filteredPayload = JsonDocument.Parse(await filtered.Content.ReadAsStringAsync());
        var filteredFinancial = filteredPayload.RootElement.GetProperty("financial");
        Assert.Equal(0, filteredFinancial.GetProperty("revenueHtCents").GetInt32());
        Assert.Equal(0, filteredFinancial.GetProperty("vatCollectedCents").GetInt32());
        Assert.Equal(3, filteredFinancial.GetProperty("byTaxRate").GetArrayLength());
    }

    private static async Task CreateFoodArticleAsync(
        HttpClient client,
        string ean13,
        string name,
        string mode)
    {
        using var response = await client.PostAsJsonAsync(
            "/api/articles",
            new
            {
                ean13,
                type = "food",
                name,
                priceHtCents = 1000,
                dlc = "2099-12-31",
                consumptionModes = new[] { mode }
            });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private static async Task CreateNonFoodArticleAsync(
        HttpClient client,
        string ean13,
        string name)
    {
        using var response = await client.PostAsJsonAsync(
            "/api/articles",
            new
            {
                ean13,
                type = "nonFood",
                name,
                priceHtCents = 1000,
                packaging = "new"
            });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private sealed class HostFactory : WebApplicationFactory<Program>
    {
        private readonly string databasePath = Path.Combine(
            Path.GetTempPath(),
            $"token-warehouse-dashboard-financial-{Guid.NewGuid():N}.db");

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

    private sealed record CalendarResponse(
        string Status,
        string Provider,
        string WarehouseDate,
        CurrentMonthResponse CurrentMonth);

    private sealed record CurrentMonthResponse(string From, string To);
}
