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
            migrationBuilder.CreateTable(
                name: "StockOperations",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    Type = table.Column<string>(type: "TEXT", nullable: false),
                    Ean13 = table.Column<string>(type: "TEXT", nullable: false),
                    PreviousPhysicalStock = table.Column<int>(type: "INTEGER", nullable: false),
                    CountedQuantity = table.Column<int>(type: "INTEGER", nullable: false),
                    InventoryDifference = table.Column<int>(type: "INTEGER", nullable: false),
                    ResultingPhysicalStock = table.Column<int>(type: "INTEGER", nullable: false),
                    TimestampUtc = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StockOperations", x => x.Id);
                    table.CheckConstraint("CK_StockOperations_CountedQuantity_NonNegative", "CountedQuantity >= 0");
                    table.CheckConstraint("CK_StockOperations_InventoryDifference_Formula", "InventoryDifference = CountedQuantity - PreviousPhysicalStock");
                    table.CheckConstraint("CK_StockOperations_PreviousPhysicalStock_NonNegative", "PreviousPhysicalStock >= 0");
                    table.CheckConstraint("CK_StockOperations_ResultingPhysicalStock_Formula", "ResultingPhysicalStock = CountedQuantity");
                    table.CheckConstraint("CK_StockOperations_ResultingPhysicalStock_NonNegative", "ResultingPhysicalStock >= 0");
                    table.ForeignKey(
                        name: "FK_StockOperations_Articles_Ean13",
                        column: x => x.Ean13,
                        principalTable: "Articles",
                        principalColumn: "Ean13",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_StockOperations_Ean13",
                table: "StockOperations",
                column: "Ean13");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "StockOperations");
        }
    }
}
