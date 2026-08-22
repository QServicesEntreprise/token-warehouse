using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TokenWarehouse.Infrastructure.Persistence.Migrations;

[DbContext(typeof(WarehouseDbContext))]
[Migration("20260822130000_HistoryFactIds")]
public partial class HistoryFactIds : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "FactId",
            table: "ArticleLifecycleHistory",
            type: "TEXT",
            nullable: false,
            defaultValue: "");

        migrationBuilder.Sql("""
            UPDATE "ArticleLifecycleHistory"
            SET "FactId" = lower(hex(randomblob(16)))
            WHERE "FactId" IS NULL OR length(trim("FactId")) = 0;
            """);

        migrationBuilder.CreateIndex(
            name: "IX_ArticleLifecycleHistory_FactId",
            table: "ArticleLifecycleHistory",
            column: "FactId",
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(
            name: "IX_ArticleLifecycleHistory_FactId",
            table: "ArticleLifecycleHistory");

        migrationBuilder.DropColumn(
            name: "FactId",
            table: "ArticleLifecycleHistory");
    }
}
