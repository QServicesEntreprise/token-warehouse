using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TokenWarehouse.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class EnforceSupplyOperationLineQuantity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "OperationType",
                table: "StockOperationLines",
                type: "TEXT",
                nullable: false,
                defaultValue: "INVENTORY");

            migrationBuilder.Sql("""
                UPDATE StockOperationLines
                SET OperationType = 'supply'
                WHERE OperationId IN (
                    SELECT Id FROM StockOperations WHERE Type = 'supply');
                """);

            migrationBuilder.AddCheckConstraint(
                name: "CK_StockOperationLines_OperationType_Valid",
                table: "StockOperationLines",
                sql: "OperationType IN ('supply', 'INVENTORY')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_StockOperationLines_Quantity_PositiveForSupply",
                table: "StockOperationLines",
                sql: "OperationType <> 'supply' OR Quantity > 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_StockOperationLines_OperationType_Valid",
                table: "StockOperationLines");

            migrationBuilder.DropCheckConstraint(
                name: "CK_StockOperationLines_Quantity_PositiveForSupply",
                table: "StockOperationLines");

            migrationBuilder.DropColumn(
                name: "OperationType",
                table: "StockOperationLines");
        }
    }
}
