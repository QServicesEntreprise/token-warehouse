using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TokenWarehouse.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InventoryOperations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_StockOperations_Quantity_Positive",
                table: "StockOperations");

            migrationBuilder.AddColumn<int>(
                name: "PreviousPhysicalStock",
                table: "StockOperations",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "CountedQuantity",
                table: "StockOperations",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "InventoryDifference",
                table: "StockOperations",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "ResultingPhysicalStock",
                table: "StockOperations",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "TimestampUtc",
                table: "StockOperations",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddCheckConstraint(
                name: "CK_StockOperations_Quantity_Positive",
                table: "StockOperations",
                sql: "Type <> 'supply' OR Quantity > 0");
            migrationBuilder.AddCheckConstraint(
                name: "CK_StockOperations_CountedQuantity_NonNegative",
                table: "StockOperations",
                sql: "CountedQuantity >= 0");
            migrationBuilder.AddCheckConstraint(
                name: "CK_StockOperations_InventoryDifference_Formula",
                table: "StockOperations",
                sql: "InventoryDifference = CountedQuantity - PreviousPhysicalStock");
            migrationBuilder.AddCheckConstraint(
                name: "CK_StockOperations_PreviousPhysicalStock_NonNegative",
                table: "StockOperations",
                sql: "PreviousPhysicalStock >= 0");
            migrationBuilder.AddCheckConstraint(
                name: "CK_StockOperations_ResultingPhysicalStock_Formula",
                table: "StockOperations",
                sql: "ResultingPhysicalStock = CountedQuantity");
            migrationBuilder.AddCheckConstraint(
                name: "CK_StockOperations_ResultingPhysicalStock_NonNegative",
                table: "StockOperations",
                sql: "ResultingPhysicalStock >= 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint("CK_StockOperations_Quantity_Positive", "StockOperations");
            migrationBuilder.DropCheckConstraint("CK_StockOperations_CountedQuantity_NonNegative", "StockOperations");
            migrationBuilder.DropCheckConstraint("CK_StockOperations_InventoryDifference_Formula", "StockOperations");
            migrationBuilder.DropCheckConstraint("CK_StockOperations_PreviousPhysicalStock_NonNegative", "StockOperations");
            migrationBuilder.DropCheckConstraint("CK_StockOperations_ResultingPhysicalStock_Formula", "StockOperations");
            migrationBuilder.DropCheckConstraint("CK_StockOperations_ResultingPhysicalStock_NonNegative", "StockOperations");

            migrationBuilder.DropColumn("PreviousPhysicalStock", "StockOperations");
            migrationBuilder.DropColumn("CountedQuantity", "StockOperations");
            migrationBuilder.DropColumn("InventoryDifference", "StockOperations");
            migrationBuilder.DropColumn("ResultingPhysicalStock", "StockOperations");
            migrationBuilder.DropColumn("TimestampUtc", "StockOperations");

            migrationBuilder.AddCheckConstraint(
                name: "CK_StockOperations_Quantity_Positive",
                table: "StockOperations",
                sql: "Quantity > 0");
        }
    }
}
