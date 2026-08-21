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
            migrationBuilder.CreateTable(
                name: "StockOperationLines",
                columns: table => new
                {
                    OperationId = table.Column<string>(type: "TEXT", nullable: false),
                    LineNumber = table.Column<int>(type: "INTEGER", nullable: false),
                    Ean13 = table.Column<string>(type: "TEXT", nullable: false),
                    Quantity = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StockOperationLines", x => new { x.OperationId, x.LineNumber });
                    table.CheckConstraint("CK_StockOperationLines_LineNumber_Positive", "LineNumber > 0");
                    table.CheckConstraint("CK_StockOperationLines_Quantity_Positive", "Quantity > 0");
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

            migrationBuilder.CreateIndex(
                name: "IX_StockOperationLines_OperationId_Ean13",
                table: "StockOperationLines",
                columns: new[] { "OperationId", "Ean13" },
                unique: true);

            migrationBuilder.Sql("""
                INSERT INTO StockOperationLines (OperationId, LineNumber, Ean13, Quantity)
                SELECT Id, 1, Ean13, Quantity
                FROM StockOperations
                WHERE Type = 'supply';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "StockOperationLines");
        }
    }
}
