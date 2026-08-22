using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TokenWarehouse.Infrastructure.Persistence.Migrations;

[DbContext(typeof(WarehouseDbContext))]
[Migration("20260822112000_HistoryReadIndexes")]
public partial class HistoryReadIndexes : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateIndex(
            name: "IX_ArticleLifecycleHistory_OccurredAt_Id",
            table: "ArticleLifecycleHistory",
            columns: new[] { "OccurredAt", "Id" });

        migrationBuilder.CreateIndex(
            name: "IX_StockOperations_TimestampUtc_Id",
            table: "StockOperations",
            columns: new[] { "TimestampUtc", "Id" });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(
            name: "IX_ArticleLifecycleHistory_OccurredAt_Id",
            table: "ArticleLifecycleHistory");

        migrationBuilder.DropIndex(
            name: "IX_StockOperations_TimestampUtc_Id",
            table: "StockOperations");
    }
}
