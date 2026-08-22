using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TokenWarehouse.Infrastructure.Persistence.Migrations;

[DbContext(typeof(WarehouseDbContext))]
[Migration("20260822150000_ImmutableSaleOperationLines")]
public partial class ImmutableSaleOperationLines : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            CREATE TRIGGER TR_StockOperationLines_Sale_Immutable_Insert
            BEFORE INSERT ON StockOperationLines
            WHEN EXISTS (
                SELECT 1
                FROM StockOperations
                WHERE Id = NEW.OperationId
                  AND Type = 'SALE')
                AND EXISTS (
                    SELECT 1
                    FROM StockOperationLines
                    WHERE OperationId = NEW.OperationId)
            BEGIN
                SELECT RAISE(ABORT, 'Committed sale operation lines are immutable.');
            END;

            CREATE TRIGGER TR_StockOperationLines_Sale_Immutable_Update
            BEFORE UPDATE ON StockOperationLines
            WHEN EXISTS (
                SELECT 1
                FROM StockOperations
                WHERE Id = OLD.OperationId
                  AND Type = 'SALE')
                OR EXISTS (
                    SELECT 1
                    FROM StockOperations
                    WHERE Id = NEW.OperationId
                      AND Type = 'SALE')
            BEGIN
                SELECT RAISE(ABORT, 'Committed sale operation lines are immutable.');
            END;

            CREATE TRIGGER TR_StockOperationLines_Sale_Immutable_Delete
            BEFORE DELETE ON StockOperationLines
            WHEN EXISTS (
                SELECT 1
                FROM StockOperations
                WHERE Id = OLD.OperationId
                  AND Type = 'SALE')
            BEGIN
                SELECT RAISE(ABORT, 'Committed sale operation lines are immutable.');
            END;
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            DROP TRIGGER IF EXISTS TR_StockOperationLines_Sale_Immutable_Insert;
            DROP TRIGGER IF EXISTS TR_StockOperationLines_Sale_Immutable_Update;
            DROP TRIGGER IF EXISTS TR_StockOperationLines_Sale_Immutable_Delete;
            """);
    }
}
