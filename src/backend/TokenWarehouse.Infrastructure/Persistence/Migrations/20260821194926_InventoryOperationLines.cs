using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TokenWarehouse.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InventoryOperationLines : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "StockOperationLines",
                columns: table => new
                {
                    OperationId = table.Column<string>(type: "TEXT", nullable: false),
                    LineNumber = table.Column<int>(type: "INTEGER", nullable: false),
                    Ean13 = table.Column<string>(type: "TEXT", nullable: false),
                    PreviousPhysicalStock = table.Column<int>(type: "INTEGER", nullable: false),
                    CountedQuantity = table.Column<int>(type: "INTEGER", nullable: false),
                    InventoryDifference = table.Column<int>(type: "INTEGER", nullable: false),
                    ResultingPhysicalStock = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StockOperationLines", x => new { x.OperationId, x.LineNumber });
                    table.CheckConstraint("CK_StockOperationLines_CountedQuantity_NonNegative", "CountedQuantity >= 0");
                    table.CheckConstraint("CK_StockOperationLines_InventoryDifference_Formula", "InventoryDifference = CountedQuantity - PreviousPhysicalStock");
                    table.CheckConstraint("CK_StockOperationLines_LineNumber_Positive", "LineNumber >= 1");
                    table.CheckConstraint("CK_StockOperationLines_PreviousPhysicalStock_NonNegative", "PreviousPhysicalStock >= 0");
                    table.CheckConstraint("CK_StockOperationLines_ResultingPhysicalStock_Formula", "ResultingPhysicalStock = CountedQuantity");
                    table.CheckConstraint("CK_StockOperationLines_ResultingPhysicalStock_NonNegative", "ResultingPhysicalStock >= 0");
                    table.ForeignKey(
                        name: "FK_StockOperationLines_Articles_Ean13",
                        column: x => x.Ean13,
                        principalTable: "Articles",
                        principalColumn: "Ean13",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StockOperationLines_StockOperations_OperationId",
                        column: x => x.OperationId,
                        principalTable: "StockOperations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_StockOperationLines_Ean13",
                table: "StockOperationLines",
                column: "Ean13");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "StockOperationLines");
        }
    }
}
