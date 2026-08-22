using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TokenWarehouse.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class HistoryOperationResults : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS TR_StockOperationLines_OperationType_MatchesOperation_Insert;
                DROP TRIGGER IF EXISTS TR_StockOperationLines_OperationType_MatchesOperation_Update;
                DROP TRIGGER IF EXISTS TR_StockOperations_Type_Immutable;
                """);

            migrationBuilder.DropCheckConstraint(
                name: "CK_StockOperations_InventoryDifference_Formula",
                table: "StockOperations");

            migrationBuilder.DropCheckConstraint(
                name: "CK_StockOperations_ResultingPhysicalStock_Formula",
                table: "StockOperations");

            migrationBuilder.DropCheckConstraint(
                name: "CK_StockOperationLines_InventoryDifference_Formula",
                table: "StockOperationLines");

            migrationBuilder.DropCheckConstraint(
                name: "CK_StockOperationLines_ResultingPhysicalStock_Formula",
                table: "StockOperationLines");

            migrationBuilder.AddCheckConstraint(
                name: "CK_StockOperations_InventoryDifference_Formula",
                table: "StockOperations",
                sql: "Type <> 'INVENTORY' OR InventoryDifference = CountedQuantity - PreviousPhysicalStock");

            migrationBuilder.AddCheckConstraint(
                name: "CK_StockOperations_ResultingPhysicalStock_Formula",
                table: "StockOperations",
                sql: "Type <> 'INVENTORY' OR ResultingPhysicalStock = CountedQuantity");

            migrationBuilder.AddCheckConstraint(
                name: "CK_StockOperationLines_InventoryDifference_Formula",
                table: "StockOperationLines",
                sql: "OperationType <> 'INVENTORY' OR InventoryDifference = CountedQuantity - PreviousPhysicalStock");

            migrationBuilder.AddCheckConstraint(
                name: "CK_StockOperationLines_ResultingPhysicalStock_Formula",
                table: "StockOperationLines",
                sql: "OperationType <> 'INVENTORY' OR ResultingPhysicalStock = CountedQuantity");

        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS TR_StockOperationLines_OperationType_MatchesOperation_Insert;
                DROP TRIGGER IF EXISTS TR_StockOperationLines_OperationType_MatchesOperation_Update;
                DROP TRIGGER IF EXISTS TR_StockOperations_Type_Immutable;
                """);

            migrationBuilder.DropCheckConstraint(
                name: "CK_StockOperations_InventoryDifference_Formula",
                table: "StockOperations");

            migrationBuilder.DropCheckConstraint(
                name: "CK_StockOperations_ResultingPhysicalStock_Formula",
                table: "StockOperations");

            migrationBuilder.DropCheckConstraint(
                name: "CK_StockOperationLines_InventoryDifference_Formula",
                table: "StockOperationLines");

            migrationBuilder.DropCheckConstraint(
                name: "CK_StockOperationLines_ResultingPhysicalStock_Formula",
                table: "StockOperationLines");

            migrationBuilder.AddCheckConstraint(
                name: "CK_StockOperations_InventoryDifference_Formula",
                table: "StockOperations",
                sql: "InventoryDifference = CountedQuantity - PreviousPhysicalStock");

            migrationBuilder.AddCheckConstraint(
                name: "CK_StockOperations_ResultingPhysicalStock_Formula",
                table: "StockOperations",
                sql: "ResultingPhysicalStock = CountedQuantity");

            migrationBuilder.AddCheckConstraint(
                name: "CK_StockOperationLines_InventoryDifference_Formula",
                table: "StockOperationLines",
                sql: "InventoryDifference = CountedQuantity - PreviousPhysicalStock");

            migrationBuilder.AddCheckConstraint(
                name: "CK_StockOperationLines_ResultingPhysicalStock_Formula",
                table: "StockOperationLines",
                sql: "ResultingPhysicalStock = CountedQuantity");

        }
    }
}
