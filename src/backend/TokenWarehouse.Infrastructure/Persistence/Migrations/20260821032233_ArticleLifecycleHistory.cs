using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TokenWarehouse.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ArticleLifecycleHistory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ArticleLifecycleHistory",
                columns: table => new
                {
                    Id = table.Column<long>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Ean13 = table.Column<string>(type: "TEXT", nullable: false),
                    PreviousStatus = table.Column<string>(type: "TEXT", nullable: false),
                    NextStatus = table.Column<string>(type: "TEXT", nullable: false),
                    OccurredAt = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ArticleLifecycleHistory", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ArticleLifecycleHistory_Articles_Ean13",
                        column: x => x.Ean13,
                        principalTable: "Articles",
                        principalColumn: "Ean13",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ArticleLifecycleHistory_Ean13",
                table: "ArticleLifecycleHistory",
                column: "Ean13");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ArticleLifecycleHistory");
        }
    }
}
