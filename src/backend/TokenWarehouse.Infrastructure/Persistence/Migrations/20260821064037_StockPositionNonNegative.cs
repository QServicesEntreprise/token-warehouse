using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TokenWarehouse.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class StockPositionNonNegative : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddCheckConstraint(
                name: "CK_StockPositions_PhysicalQuantity_NonNegative",
                table: "StockPositions",
                sql: "PhysicalQuantity >= 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_StockPositions_PhysicalQuantity_NonNegative",
                table: "StockPositions");
        }
    }
}
