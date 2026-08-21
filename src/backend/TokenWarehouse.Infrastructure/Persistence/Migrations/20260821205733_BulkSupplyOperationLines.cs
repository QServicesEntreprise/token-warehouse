using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TokenWarehouse.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class BulkSupplyOperationLines : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Quantity",
                table: "StockOperationLines",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.Sql("""
                INSERT INTO StockOperationLines
                    (OperationId, LineNumber, Ean13, Quantity,
                     PreviousPhysicalStock, CountedQuantity, InventoryDifference, ResultingPhysicalStock)
                SELECT Id, 1, Ean13, Quantity, 0, 0, 0, 0
                FROM StockOperations
                WHERE Type = 'supply'
                  AND NOT EXISTS (
                      SELECT 1
                      FROM StockOperationLines line
                      WHERE line.OperationId = StockOperations.Id);
                """);

            migrationBuilder.AddCheckConstraint(
                name: "CK_StockOperationLines_Quantity_NonNegative",
                table: "StockOperationLines",
                sql: "Quantity >= 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_StockOperationLines_Quantity_NonNegative",
                table: "StockOperationLines");

            migrationBuilder.Sql("""
                DELETE FROM StockOperationLines
                WHERE OperationId IN (
                    SELECT Id FROM StockOperations WHERE Type = 'supply');
                """);

            migrationBuilder.DropColumn(
                name: "Quantity",
                table: "StockOperationLines");
        }
    }
}
