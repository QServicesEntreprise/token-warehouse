using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TokenWarehouse.Infrastructure.Persistence.Migrations;

[DbContext(typeof(WarehouseDbContext))]
[Migration("20260822111000_HistoryOperationResultTriggers")]
public partial class HistoryOperationResultTriggers : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            CREATE TRIGGER TR_StockOperationLines_OperationType_MatchesOperation_Insert
            BEFORE INSERT ON StockOperationLines
            WHEN NOT EXISTS (
                SELECT 1
                FROM StockOperations
                WHERE Id = NEW.OperationId
                  AND Type = NEW.OperationType)
            BEGIN
                SELECT RAISE(ABORT, 'Stock operation line type does not match operation.');
            END;

            CREATE TRIGGER TR_StockOperationLines_OperationType_MatchesOperation_Update
            BEFORE UPDATE OF OperationId, OperationType ON StockOperationLines
            WHEN NOT EXISTS (
                SELECT 1
                FROM StockOperations
                WHERE Id = NEW.OperationId
                  AND Type = NEW.OperationType)
            BEGIN
                SELECT RAISE(ABORT, 'Stock operation line type does not match operation.');
            END;

            CREATE TRIGGER TR_StockOperations_Type_Immutable
            BEFORE UPDATE OF Type ON StockOperations
            WHEN NEW.Type <> OLD.Type
            BEGIN
                SELECT RAISE(ABORT, 'Stock operation type is immutable.');
            END;
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            DROP TRIGGER IF EXISTS TR_StockOperationLines_OperationType_MatchesOperation_Insert;
            DROP TRIGGER IF EXISTS TR_StockOperationLines_OperationType_MatchesOperation_Update;
            DROP TRIGGER IF EXISTS TR_StockOperations_Type_Immutable;
            """);
    }
}
