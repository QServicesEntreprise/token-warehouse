using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TokenWarehouse.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ArticleAttributeUpdates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Version",
                table: "Articles",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "ChangesJson",
                table: "ArticleLifecycleHistory",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Kind",
                table: "ArticleLifecycleHistory",
                type: "TEXT",
                nullable: false,
                defaultValue: "lifecycle");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Version",
                table: "Articles");

            migrationBuilder.DropColumn(
                name: "ChangesJson",
                table: "ArticleLifecycleHistory");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "ArticleLifecycleHistory");
        }
    }
}
