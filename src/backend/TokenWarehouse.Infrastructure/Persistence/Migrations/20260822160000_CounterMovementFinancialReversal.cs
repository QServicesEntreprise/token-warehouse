using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TokenWarehouse.Infrastructure.Persistence.Migrations;

[DbContext(typeof(WarehouseDbContext))]
[Migration("20260822160000_CounterMovementFinancialReversal")]
public partial class CounterMovementFinancialReversal : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            CREATE TRIGGER TR_StockOperations_CounterMovementFinancialReversal_Constraints_Insert
            BEFORE INSERT ON StockOperations
            WHEN NEW.Type = 'COUNTER_MOVEMENT'
                AND NEW.SourceOperationType = 'SALE'
                AND NOT (
                    NEW.SourceOperationId IS NOT NULL
                    AND NEW.SaleCommitDataType = 'sale.financial.reversal.v1'
                    AND NEW.SaleCommitDataPayload IS NOT NULL
                    AND json_valid(NEW.SaleCommitDataPayload) = 1
                    AND json_type(NEW.SaleCommitDataPayload, '$.sourceOperationId') = 'text'
                    AND length(trim(json_extract(NEW.SaleCommitDataPayload, '$.sourceOperationId'))) > 0
                    AND json_extract(NEW.SaleCommitDataPayload, '$.sourceOperationId') = NEW.SourceOperationId
                    AND json_type(NEW.SaleCommitDataPayload, '$.saleContext') IN ('text', 'null')
                    AND json_type(NEW.SaleCommitDataPayload, '$.unitPriceHtCents') = 'integer'
                    AND json_extract(NEW.SaleCommitDataPayload, '$.unitPriceHtCents') >= 0
                    AND json_type(NEW.SaleCommitDataPayload, '$.taxRateCode') = 'text'
                    AND json_type(NEW.SaleCommitDataPayload, '$.taxRateNumerator') = 'integer'
                    AND json_type(NEW.SaleCommitDataPayload, '$.taxRateDenominator') = 'integer'
                    AND json_type(NEW.SaleCommitDataPayload, '$.amountHtCents') = 'integer'
                    AND json_extract(NEW.SaleCommitDataPayload, '$.amountHtCents') <= 0
                    AND json_extract(NEW.SaleCommitDataPayload, '$.amountHtCents') > -2147483648
                    AND json_type(NEW.SaleCommitDataPayload, '$.vatCents') = 'integer'
                    AND json_extract(NEW.SaleCommitDataPayload, '$.vatCents') <= 0
                    AND json_extract(NEW.SaleCommitDataPayload, '$.vatCents') > -2147483648
                    AND json_type(NEW.SaleCommitDataPayload, '$.amountTtcCents') = 'integer'
                    AND json_extract(NEW.SaleCommitDataPayload, '$.amountTtcCents') <= 0
                    AND json_extract(NEW.SaleCommitDataPayload, '$.amountTtcCents') > -2147483648
                    AND json_extract(NEW.SaleCommitDataPayload, '$.amountTtcCents')
                        = json_extract(NEW.SaleCommitDataPayload, '$.amountHtCents')
                            + json_extract(NEW.SaleCommitDataPayload, '$.vatCents')
                    AND (
                        (json_extract(NEW.SaleCommitDataPayload, '$.saleContext') = 'takeaway'
                            AND json_extract(NEW.SaleCommitDataPayload, '$.taxRateCode') = 'takeaway'
                            AND json_extract(NEW.SaleCommitDataPayload, '$.taxRateNumerator') = 11
                            AND json_extract(NEW.SaleCommitDataPayload, '$.taxRateDenominator') = 200)
                        OR (json_extract(NEW.SaleCommitDataPayload, '$.saleContext') = 'onsite'
                            AND json_extract(NEW.SaleCommitDataPayload, '$.taxRateCode') = 'onsite'
                            AND json_extract(NEW.SaleCommitDataPayload, '$.taxRateNumerator') = 1
                            AND json_extract(NEW.SaleCommitDataPayload, '$.taxRateDenominator') = 10)
                        OR (json_type(NEW.SaleCommitDataPayload, '$.saleContext') = 'null'
                            AND json_extract(NEW.SaleCommitDataPayload, '$.taxRateCode') = 'nonFood'
                            AND json_extract(NEW.SaleCommitDataPayload, '$.taxRateNumerator') = 1
                            AND json_extract(NEW.SaleCommitDataPayload, '$.taxRateDenominator') = 5)
                    )
                )
            BEGIN
                SELECT RAISE(ABORT, 'Sale financial reversal is invalid.');
            END;

            CREATE TRIGGER TR_StockOperations_CounterMovementFinancialReversal_Constraints_Update
            BEFORE UPDATE ON StockOperations
            WHEN NEW.Type = 'COUNTER_MOVEMENT'
                AND NEW.SourceOperationType = 'SALE'
                AND NOT (
                    NEW.SourceOperationId IS NOT NULL
                    AND NEW.SaleCommitDataType = 'sale.financial.reversal.v1'
                    AND NEW.SaleCommitDataPayload IS NOT NULL
                    AND json_valid(NEW.SaleCommitDataPayload) = 1
                    AND json_type(NEW.SaleCommitDataPayload, '$.sourceOperationId') = 'text'
                    AND length(trim(json_extract(NEW.SaleCommitDataPayload, '$.sourceOperationId'))) > 0
                    AND json_extract(NEW.SaleCommitDataPayload, '$.sourceOperationId') = NEW.SourceOperationId
                    AND json_type(NEW.SaleCommitDataPayload, '$.saleContext') IN ('text', 'null')
                    AND json_type(NEW.SaleCommitDataPayload, '$.unitPriceHtCents') = 'integer'
                    AND json_extract(NEW.SaleCommitDataPayload, '$.unitPriceHtCents') >= 0
                    AND json_type(NEW.SaleCommitDataPayload, '$.taxRateCode') = 'text'
                    AND json_type(NEW.SaleCommitDataPayload, '$.taxRateNumerator') = 'integer'
                    AND json_type(NEW.SaleCommitDataPayload, '$.taxRateDenominator') = 'integer'
                    AND json_type(NEW.SaleCommitDataPayload, '$.amountHtCents') = 'integer'
                    AND json_extract(NEW.SaleCommitDataPayload, '$.amountHtCents') <= 0
                    AND json_extract(NEW.SaleCommitDataPayload, '$.amountHtCents') > -2147483648
                    AND json_type(NEW.SaleCommitDataPayload, '$.vatCents') = 'integer'
                    AND json_extract(NEW.SaleCommitDataPayload, '$.vatCents') <= 0
                    AND json_extract(NEW.SaleCommitDataPayload, '$.vatCents') > -2147483648
                    AND json_type(NEW.SaleCommitDataPayload, '$.amountTtcCents') = 'integer'
                    AND json_extract(NEW.SaleCommitDataPayload, '$.amountTtcCents') <= 0
                    AND json_extract(NEW.SaleCommitDataPayload, '$.amountTtcCents') > -2147483648
                    AND json_extract(NEW.SaleCommitDataPayload, '$.amountTtcCents')
                        = json_extract(NEW.SaleCommitDataPayload, '$.amountHtCents')
                            + json_extract(NEW.SaleCommitDataPayload, '$.vatCents')
                    AND (
                        (json_extract(NEW.SaleCommitDataPayload, '$.saleContext') = 'takeaway'
                            AND json_extract(NEW.SaleCommitDataPayload, '$.taxRateCode') = 'takeaway'
                            AND json_extract(NEW.SaleCommitDataPayload, '$.taxRateNumerator') = 11
                            AND json_extract(NEW.SaleCommitDataPayload, '$.taxRateDenominator') = 200)
                        OR (json_extract(NEW.SaleCommitDataPayload, '$.saleContext') = 'onsite'
                            AND json_extract(NEW.SaleCommitDataPayload, '$.taxRateCode') = 'onsite'
                            AND json_extract(NEW.SaleCommitDataPayload, '$.taxRateNumerator') = 1
                            AND json_extract(NEW.SaleCommitDataPayload, '$.taxRateDenominator') = 10)
                        OR (json_type(NEW.SaleCommitDataPayload, '$.saleContext') = 'null'
                            AND json_extract(NEW.SaleCommitDataPayload, '$.taxRateCode') = 'nonFood'
                            AND json_extract(NEW.SaleCommitDataPayload, '$.taxRateNumerator') = 1
                            AND json_extract(NEW.SaleCommitDataPayload, '$.taxRateDenominator') = 5)
                    )
                )
            BEGIN
                SELECT RAISE(ABORT, 'Sale financial reversal is invalid.');
            END;

            CREATE TRIGGER TR_StockOperations_CounterMovement_Immutable_Update
            BEFORE UPDATE ON StockOperations
            WHEN OLD.Type = 'COUNTER_MOVEMENT'
            BEGIN
                SELECT RAISE(ABORT, 'Counter movement is immutable.');
            END;

            CREATE TRIGGER TR_StockOperations_CounterMovement_Immutable_Delete
            BEFORE DELETE ON StockOperations
            WHEN OLD.Type = 'COUNTER_MOVEMENT'
            BEGIN
                SELECT RAISE(ABORT, 'Counter movement is immutable.');
            END;

            CREATE TRIGGER TR_StockOperationLines_CounterMovement_Immutable_Update
            BEFORE UPDATE ON StockOperationLines
            WHEN EXISTS (
                SELECT 1
                FROM StockOperations
                WHERE Id = OLD.OperationId
                  AND Type = 'COUNTER_MOVEMENT')
                OR EXISTS (
                    SELECT 1
                    FROM StockOperations
                    WHERE Id = NEW.OperationId
                      AND Type = 'COUNTER_MOVEMENT')
            BEGIN
                SELECT RAISE(ABORT, 'Counter movement lines are immutable.');
            END;

            CREATE TRIGGER TR_StockOperationLines_CounterMovement_Immutable_Delete
            BEFORE DELETE ON StockOperationLines
            WHEN EXISTS (
                SELECT 1
                FROM StockOperations
                WHERE Id = OLD.OperationId
                  AND Type = 'COUNTER_MOVEMENT')
            BEGIN
                SELECT RAISE(ABORT, 'Counter movement lines are immutable.');
            END;
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            DROP TRIGGER IF EXISTS TR_StockOperations_CounterMovementFinancialReversal_Constraints_Insert;
            DROP TRIGGER IF EXISTS TR_StockOperations_CounterMovementFinancialReversal_Constraints_Update;
            DROP TRIGGER IF EXISTS TR_StockOperations_CounterMovement_Immutable_Update;
            DROP TRIGGER IF EXISTS TR_StockOperations_CounterMovement_Immutable_Delete;
            DROP TRIGGER IF EXISTS TR_StockOperationLines_CounterMovement_Immutable_Update;
            DROP TRIGGER IF EXISTS TR_StockOperationLines_CounterMovement_Immutable_Delete;
            """);
    }
}
