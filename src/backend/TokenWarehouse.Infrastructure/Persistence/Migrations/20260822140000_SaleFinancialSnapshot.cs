using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TokenWarehouse.Infrastructure.Persistence.Migrations;

[DbContext(typeof(WarehouseDbContext))]
[Migration("20260822140000_SaleFinancialSnapshot")]
public partial class SaleFinancialSnapshot : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "SaleFinancialContext",
            table: "StockOperations",
            type: "TEXT",
            nullable: true);

        migrationBuilder.AddColumn<int>(
            name: "SaleFinancialUnitPriceHtCents",
            table: "StockOperations",
            type: "INTEGER",
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "SaleFinancialTaxRateCode",
            table: "StockOperations",
            type: "TEXT",
            nullable: true);

        migrationBuilder.AddColumn<int>(
            name: "SaleFinancialTaxRateNumerator",
            table: "StockOperations",
            type: "INTEGER",
            nullable: true);

        migrationBuilder.AddColumn<int>(
            name: "SaleFinancialTaxRateDenominator",
            table: "StockOperations",
            type: "INTEGER",
            nullable: true);

        migrationBuilder.AddColumn<int>(
            name: "SaleFinancialAmountHtCents",
            table: "StockOperations",
            type: "INTEGER",
            nullable: true);

        migrationBuilder.AddColumn<int>(
            name: "SaleFinancialVatCents",
            table: "StockOperations",
            type: "INTEGER",
            nullable: true);

        migrationBuilder.AddColumn<int>(
            name: "SaleFinancialAmountTtcCents",
            table: "StockOperations",
            type: "INTEGER",
            nullable: true);

        migrationBuilder.Sql("""
            CREATE TRIGGER TR_StockOperations_SaleFinancialSnapshot_Insert
            BEFORE INSERT ON StockOperations
            WHEN NEW.Type = 'SALE'
                AND NEW.SaleCommitDataType = 'sale.financial.v1'
                AND (
                    NEW.SaleFinancialContext IS NOT NULL
                        AND NEW.SaleFinancialContext NOT IN ('takeaway', 'onsite')
                    OR NEW.SaleFinancialUnitPriceHtCents IS NULL
                    OR NEW.SaleFinancialUnitPriceHtCents < 0
                    OR NEW.SaleFinancialTaxRateCode IS NULL
                    OR NEW.SaleFinancialTaxRateNumerator IS NULL
                    OR NEW.SaleFinancialTaxRateDenominator IS NULL
                    OR NEW.SaleFinancialAmountHtCents IS NULL
                    OR NEW.SaleFinancialAmountHtCents < 0
                    OR NEW.SaleFinancialVatCents IS NULL
                    OR NEW.SaleFinancialVatCents < 0
                    OR NEW.SaleFinancialAmountTtcCents IS NULL
                    OR NEW.SaleFinancialAmountTtcCents < 0
                    OR NOT (
                        (NEW.SaleFinancialContext = 'takeaway'
                            AND NEW.SaleFinancialTaxRateCode = 'takeaway'
                            AND NEW.SaleFinancialTaxRateNumerator = 11
                            AND NEW.SaleFinancialTaxRateDenominator = 200)
                        OR (NEW.SaleFinancialContext = 'onsite'
                            AND NEW.SaleFinancialTaxRateCode = 'onsite'
                            AND NEW.SaleFinancialTaxRateNumerator = 1
                            AND NEW.SaleFinancialTaxRateDenominator = 10)
                        OR (NEW.SaleFinancialContext IS NULL
                            AND NEW.SaleFinancialTaxRateCode = 'nonFood'
                            AND NEW.SaleFinancialTaxRateNumerator = 1
                            AND NEW.SaleFinancialTaxRateDenominator = 5)
                    )
                    OR NEW.SaleFinancialAmountHtCents
                        <> NEW.SaleFinancialUnitPriceHtCents * NEW.Quantity
                    OR NEW.SaleFinancialVatCents
                        <> (NEW.SaleFinancialAmountHtCents
                            * NEW.SaleFinancialTaxRateNumerator * 2
                            + NEW.SaleFinancialTaxRateDenominator)
                            / (NEW.SaleFinancialTaxRateDenominator * 2)
                    OR NEW.SaleFinancialAmountTtcCents <> NEW.SaleFinancialAmountHtCents + NEW.SaleFinancialVatCents
                )
            BEGIN
                SELECT RAISE(ABORT, 'Sale financial snapshot is invalid.');
            END;
            """);

        migrationBuilder.Sql("""
            CREATE TRIGGER TR_StockOperations_SaleFinancialSnapshot_Update
            BEFORE UPDATE OF SaleCommitDataType, SaleFinancialContext, SaleFinancialUnitPriceHtCents,
                SaleFinancialTaxRateCode, SaleFinancialTaxRateNumerator, SaleFinancialTaxRateDenominator,
                SaleFinancialAmountHtCents, SaleFinancialVatCents, SaleFinancialAmountTtcCents
            ON StockOperations
            WHEN NEW.Type = 'SALE'
                AND NEW.SaleCommitDataType = 'sale.financial.v1'
                AND (
                    NEW.SaleFinancialContext IS NOT NULL
                        AND NEW.SaleFinancialContext NOT IN ('takeaway', 'onsite')
                    OR NEW.SaleFinancialUnitPriceHtCents IS NULL
                    OR NEW.SaleFinancialUnitPriceHtCents < 0
                    OR NEW.SaleFinancialTaxRateCode IS NULL
                    OR NEW.SaleFinancialTaxRateNumerator IS NULL
                    OR NEW.SaleFinancialTaxRateDenominator IS NULL
                    OR NEW.SaleFinancialAmountHtCents IS NULL
                    OR NEW.SaleFinancialAmountHtCents < 0
                    OR NEW.SaleFinancialVatCents IS NULL
                    OR NEW.SaleFinancialVatCents < 0
                    OR NEW.SaleFinancialAmountTtcCents IS NULL
                    OR NEW.SaleFinancialAmountTtcCents < 0
                    OR NOT (
                        (NEW.SaleFinancialContext = 'takeaway'
                            AND NEW.SaleFinancialTaxRateCode = 'takeaway'
                            AND NEW.SaleFinancialTaxRateNumerator = 11
                            AND NEW.SaleFinancialTaxRateDenominator = 200)
                        OR (NEW.SaleFinancialContext = 'onsite'
                            AND NEW.SaleFinancialTaxRateCode = 'onsite'
                            AND NEW.SaleFinancialTaxRateNumerator = 1
                            AND NEW.SaleFinancialTaxRateDenominator = 10)
                        OR (NEW.SaleFinancialContext IS NULL
                            AND NEW.SaleFinancialTaxRateCode = 'nonFood'
                            AND NEW.SaleFinancialTaxRateNumerator = 1
                            AND NEW.SaleFinancialTaxRateDenominator = 5)
                    )
                    OR NEW.SaleFinancialAmountHtCents
                        <> NEW.SaleFinancialUnitPriceHtCents * NEW.Quantity
                    OR NEW.SaleFinancialVatCents
                        <> (NEW.SaleFinancialAmountHtCents
                            * NEW.SaleFinancialTaxRateNumerator * 2
                            + NEW.SaleFinancialTaxRateDenominator)
                            / (NEW.SaleFinancialTaxRateDenominator * 2)
                    OR NEW.SaleFinancialAmountTtcCents <> NEW.SaleFinancialAmountHtCents + NEW.SaleFinancialVatCents
                )
            BEGIN
                SELECT RAISE(ABORT, 'Sale financial snapshot is invalid.');
            END;
            """);

        migrationBuilder.Sql("""
            CREATE TRIGGER TR_StockOperations_SaleFinancialSnapshot_Immutable
            BEFORE UPDATE ON StockOperations
            WHEN OLD.Type = 'SALE'
                AND OLD.SaleCommitDataType = 'sale.financial.v1'
                AND (
                    OLD.Id IS NOT NEW.Id
                    OR OLD.Type IS NOT NEW.Type
                    OR OLD.Ean13 IS NOT NEW.Ean13
                    OR OLD.Quantity IS NOT NEW.Quantity
                    OR OLD.OccurredAt IS NOT NEW.OccurredAt
                    OR OLD.PreviousPhysicalStock IS NOT NEW.PreviousPhysicalStock
                    OR OLD.CountedQuantity IS NOT NEW.CountedQuantity
                    OR OLD.InventoryDifference IS NOT NEW.InventoryDifference
                    OR OLD.ResultingPhysicalStock IS NOT NEW.ResultingPhysicalStock
                    OR OLD.TimestampUtc IS NOT NEW.TimestampUtc
                    OR OLD.SourceOperationId IS NOT NEW.SourceOperationId
                    OR OLD.SourceOperationType IS NOT NEW.SourceOperationType
                    OR OLD.Justification IS NOT NEW.Justification
                    OR OLD.SaleCommitDataType IS NOT NEW.SaleCommitDataType
                    OR OLD.SaleFinancialContext IS NOT NEW.SaleFinancialContext
                    OR OLD.SaleFinancialUnitPriceHtCents IS NOT NEW.SaleFinancialUnitPriceHtCents
                    OR OLD.SaleFinancialTaxRateCode IS NOT NEW.SaleFinancialTaxRateCode
                    OR OLD.SaleFinancialTaxRateNumerator IS NOT NEW.SaleFinancialTaxRateNumerator
                    OR OLD.SaleFinancialTaxRateDenominator IS NOT NEW.SaleFinancialTaxRateDenominator
                    OR OLD.SaleFinancialAmountHtCents IS NOT NEW.SaleFinancialAmountHtCents
                    OR OLD.SaleFinancialVatCents IS NOT NEW.SaleFinancialVatCents
                    OR OLD.SaleFinancialAmountTtcCents IS NOT NEW.SaleFinancialAmountTtcCents
                    OR OLD.SaleCommitDataPayload IS NOT NEW.SaleCommitDataPayload
                )
            BEGIN
                SELECT RAISE(ABORT, 'Sale financial snapshot is immutable.');
            END;
            """);

        migrationBuilder.Sql("""
            CREATE TRIGGER TR_StockOperations_SaleFinancialSnapshot_Delete
            BEFORE DELETE ON StockOperations
            WHEN OLD.Type = 'SALE'
                AND OLD.SaleCommitDataType = 'sale.financial.v1'
            BEGIN
                SELECT RAISE(ABORT, 'Sale financial snapshot is immutable.');
            END;
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            DROP TRIGGER IF EXISTS TR_StockOperations_SaleFinancialSnapshot_Insert;
            """);

        migrationBuilder.Sql("""
            DROP TRIGGER IF EXISTS TR_StockOperations_SaleFinancialSnapshot_Update;
            """);

        migrationBuilder.Sql("""
            DROP TRIGGER IF EXISTS TR_StockOperations_SaleFinancialSnapshot_Immutable;
            """);

        migrationBuilder.Sql("""
            DROP TRIGGER IF EXISTS TR_StockOperations_SaleFinancialSnapshot_Delete;
            """);

        migrationBuilder.DropColumn(
            name: "SaleFinancialContext",
            table: "StockOperations");

        migrationBuilder.DropColumn(
            name: "SaleFinancialUnitPriceHtCents",
            table: "StockOperations");

        migrationBuilder.DropColumn(
            name: "SaleFinancialTaxRateCode",
            table: "StockOperations");

        migrationBuilder.DropColumn(
            name: "SaleFinancialTaxRateNumerator",
            table: "StockOperations");

        migrationBuilder.DropColumn(
            name: "SaleFinancialTaxRateDenominator",
            table: "StockOperations");

        migrationBuilder.DropColumn(
            name: "SaleFinancialAmountHtCents",
            table: "StockOperations");

        migrationBuilder.DropColumn(
            name: "SaleFinancialVatCents",
            table: "StockOperations");

        migrationBuilder.DropColumn(
            name: "SaleFinancialAmountTtcCents",
            table: "StockOperations");
    }
}
