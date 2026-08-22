using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TokenWarehouse.Infrastructure.Persistence.Migrations;

[DbContext(typeof(WarehouseDbContext))]
[Migration("20260822100000_CounterMovements")]
public partial class CounterMovements : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            DROP TRIGGER IF EXISTS TR_StockOperationLines_OperationType_MatchesOperation_Insert;
            DROP TRIGGER IF EXISTS TR_StockOperationLines_OperationType_MatchesOperation_Update;
            """);

        migrationBuilder.AddColumn<string>(
            name: "Justification",
            table: "StockOperations",
            type: "TEXT",
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "SourceOperationId",
            table: "StockOperations",
            type: "TEXT",
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "SourceOperationType",
            table: "StockOperations",
            type: "TEXT",
            nullable: true);

        migrationBuilder.AddColumn<int>(
            name: "SourceEffect",
            table: "StockOperationLines",
            type: "INTEGER",
            nullable: false,
            defaultValue: 0);

        migrationBuilder.AddColumn<int>(
            name: "InverseEffect",
            table: "StockOperationLines",
            type: "INTEGER",
            nullable: false,
            defaultValue: 0);

        migrationBuilder.Sql("""
            UPDATE StockOperationLines
            SET SourceEffect = CASE OperationType
                WHEN 'supply' THEN Quantity
                WHEN 'INVENTORY' THEN InventoryDifference
                ELSE SourceEffect
            END
            WHERE OperationType IN ('supply', 'INVENTORY');
            """);

        migrationBuilder.Sql("""
            CREATE TABLE "__ef_temp_StockOperationLines" (
                "OperationId" TEXT NOT NULL,
                "LineNumber" INTEGER NOT NULL,
                "Ean13" TEXT NOT NULL,
                "OperationType" TEXT NOT NULL DEFAULT 'INVENTORY',
                "Quantity" INTEGER NOT NULL,
                "PreviousPhysicalStock" INTEGER NOT NULL,
                "CountedQuantity" INTEGER NOT NULL,
                "InventoryDifference" INTEGER NOT NULL,
                "ResultingPhysicalStock" INTEGER NOT NULL,
                "SourceEffect" INTEGER NOT NULL,
                "InverseEffect" INTEGER NOT NULL,
                CONSTRAINT "PK_StockOperationLines" PRIMARY KEY ("OperationId", "LineNumber"),
                CONSTRAINT "CK_StockOperationLines_CountedQuantity_NonNegative" CHECK ("CountedQuantity" >= 0),
                CONSTRAINT "CK_StockOperationLines_InventoryDifference_Formula" CHECK ("InventoryDifference" = "CountedQuantity" - "PreviousPhysicalStock"),
                CONSTRAINT "CK_StockOperationLines_LineNumber_Positive" CHECK ("LineNumber" >= 1),
                CONSTRAINT "CK_StockOperationLines_OperationType_Valid" CHECK ("OperationType" IN ('supply', 'INVENTORY', 'SALE', 'COUNTER_MOVEMENT')),
                CONSTRAINT "CK_StockOperationLines_PreviousPhysicalStock_NonNegative" CHECK ("PreviousPhysicalStock" >= 0),
                CONSTRAINT "CK_StockOperationLines_Quantity_NonNegative" CHECK ("Quantity" >= 0),
                CONSTRAINT "CK_StockOperationLines_Quantity_PositiveForSupply" CHECK ("OperationType" <> 'supply' OR "Quantity" > 0),
                CONSTRAINT "CK_StockOperationLines_ResultingPhysicalStock_Formula" CHECK ("ResultingPhysicalStock" = "CountedQuantity"),
                CONSTRAINT "CK_StockOperationLines_ResultingPhysicalStock_NonNegative" CHECK ("ResultingPhysicalStock" >= 0),
                CONSTRAINT "CK_StockOperationLines_CounterMovement_Inverse" CHECK ("OperationType" <> 'COUNTER_MOVEMENT' OR "InverseEffect" = -"SourceEffect")
            );

            INSERT INTO "__ef_temp_StockOperationLines" (
                "OperationId", "LineNumber", "Ean13", "OperationType", "Quantity",
                "PreviousPhysicalStock", "CountedQuantity", "InventoryDifference",
                "ResultingPhysicalStock", "SourceEffect", "InverseEffect")
            SELECT
                "OperationId", "LineNumber", "Ean13", "OperationType", "Quantity",
                "PreviousPhysicalStock", "CountedQuantity", "InventoryDifference",
                "ResultingPhysicalStock", "SourceEffect", "InverseEffect"
            FROM "StockOperationLines";

            DROP TABLE "StockOperationLines";

            CREATE TABLE "__ef_temp_StockOperations" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_StockOperations" PRIMARY KEY,
                "Type" TEXT NOT NULL,
                "Ean13" TEXT NOT NULL,
                "Quantity" INTEGER NOT NULL,
                "OccurredAt" TEXT NOT NULL,
                "PreviousPhysicalStock" INTEGER NOT NULL,
                "CountedQuantity" INTEGER NOT NULL,
                "InventoryDifference" INTEGER NOT NULL,
                "ResultingPhysicalStock" INTEGER NOT NULL,
                "TimestampUtc" TEXT NOT NULL,
                "Justification" TEXT NULL,
                "SourceOperationId" TEXT NULL,
                "SourceOperationType" TEXT NULL,
                CONSTRAINT "CK_StockOperations_Quantity_Positive" CHECK ("Type" <> 'supply' OR "Quantity" > 0),
                CONSTRAINT "CK_StockOperations_PreviousPhysicalStock_NonNegative" CHECK ("PreviousPhysicalStock" >= 0),
                CONSTRAINT "CK_StockOperations_CountedQuantity_NonNegative" CHECK ("CountedQuantity" >= 0),
                CONSTRAINT "CK_StockOperations_ResultingPhysicalStock_NonNegative" CHECK ("ResultingPhysicalStock" >= 0),
                CONSTRAINT "CK_StockOperations_InventoryDifference_Formula" CHECK ("InventoryDifference" = "CountedQuantity" - "PreviousPhysicalStock"),
                CONSTRAINT "CK_StockOperations_ResultingPhysicalStock_Formula" CHECK ("ResultingPhysicalStock" = "CountedQuantity"),
                CONSTRAINT "CK_StockOperations_CounterMovement_Fields" CHECK ("Type" <> 'COUNTER_MOVEMENT' OR ("SourceOperationId" IS NOT NULL AND length(trim("SourceOperationId")) > 0 AND "SourceOperationType" IS NOT NULL AND "SourceOperationType" IN ('SUPPLY', 'INVENTORY', 'SALE') AND "Justification" IS NOT NULL AND length(trim("Justification")) > 0)),
                CONSTRAINT "FK_StockOperations_Articles_Ean13" FOREIGN KEY ("Ean13") REFERENCES "Articles" ("Ean13") ON DELETE RESTRICT,
                CONSTRAINT "FK_StockOperations_StockOperations_SourceOperationId" FOREIGN KEY ("SourceOperationId") REFERENCES "__ef_temp_StockOperations" ("Id") ON DELETE RESTRICT
            );

            INSERT INTO "__ef_temp_StockOperations" (
                "Id", "Type", "Ean13", "Quantity", "OccurredAt", "PreviousPhysicalStock",
                "CountedQuantity", "InventoryDifference", "ResultingPhysicalStock", "TimestampUtc",
                "Justification", "SourceOperationId", "SourceOperationType")
            SELECT
                "Id", "Type", "Ean13", "Quantity", "OccurredAt", "PreviousPhysicalStock",
                "CountedQuantity", "InventoryDifference", "ResultingPhysicalStock", "TimestampUtc",
                "Justification", "SourceOperationId", "SourceOperationType"
            FROM "StockOperations";

            DROP TABLE "StockOperations";
            ALTER TABLE "__ef_temp_StockOperations" RENAME TO "StockOperations";
            CREATE INDEX "IX_StockOperations_Ean13" ON "StockOperations" ("Ean13");
            CREATE UNIQUE INDEX "IX_StockOperations_SourceOperationId" ON "StockOperations" ("SourceOperationId");

            CREATE TABLE "__ef_temp_StockOperationLines_Final" (
                "OperationId" TEXT NOT NULL,
                "LineNumber" INTEGER NOT NULL,
                "Ean13" TEXT NOT NULL,
                "OperationType" TEXT NOT NULL DEFAULT 'INVENTORY',
                "Quantity" INTEGER NOT NULL,
                "PreviousPhysicalStock" INTEGER NOT NULL,
                "CountedQuantity" INTEGER NOT NULL,
                "InventoryDifference" INTEGER NOT NULL,
                "ResultingPhysicalStock" INTEGER NOT NULL,
                "SourceEffect" INTEGER NOT NULL,
                "InverseEffect" INTEGER NOT NULL,
                CONSTRAINT "PK_StockOperationLines" PRIMARY KEY ("OperationId", "LineNumber"),
                CONSTRAINT "CK_StockOperationLines_CountedQuantity_NonNegative" CHECK ("CountedQuantity" >= 0),
                CONSTRAINT "CK_StockOperationLines_InventoryDifference_Formula" CHECK ("InventoryDifference" = "CountedQuantity" - "PreviousPhysicalStock"),
                CONSTRAINT "CK_StockOperationLines_LineNumber_Positive" CHECK ("LineNumber" >= 1),
                CONSTRAINT "CK_StockOperationLines_OperationType_Valid" CHECK ("OperationType" IN ('supply', 'INVENTORY', 'SALE', 'COUNTER_MOVEMENT')),
                CONSTRAINT "CK_StockOperationLines_PreviousPhysicalStock_NonNegative" CHECK ("PreviousPhysicalStock" >= 0),
                CONSTRAINT "CK_StockOperationLines_Quantity_NonNegative" CHECK ("Quantity" >= 0),
                CONSTRAINT "CK_StockOperationLines_Quantity_PositiveForSupply" CHECK ("OperationType" <> 'supply' OR "Quantity" > 0),
                CONSTRAINT "CK_StockOperationLines_ResultingPhysicalStock_Formula" CHECK ("ResultingPhysicalStock" = "CountedQuantity"),
                CONSTRAINT "CK_StockOperationLines_ResultingPhysicalStock_NonNegative" CHECK ("ResultingPhysicalStock" >= 0),
                CONSTRAINT "CK_StockOperationLines_CounterMovement_Inverse" CHECK ("OperationType" <> 'COUNTER_MOVEMENT' OR "InverseEffect" = -"SourceEffect"),
                CONSTRAINT "FK_StockOperationLines_Articles_Ean13" FOREIGN KEY ("Ean13") REFERENCES "Articles" ("Ean13") ON DELETE RESTRICT,
                CONSTRAINT "FK_StockOperationLines_StockOperations_OperationId" FOREIGN KEY ("OperationId") REFERENCES "StockOperations" ("Id") ON DELETE CASCADE
            );

            INSERT INTO "__ef_temp_StockOperationLines_Final" (
                "OperationId", "LineNumber", "Ean13", "OperationType", "Quantity",
                "PreviousPhysicalStock", "CountedQuantity", "InventoryDifference",
                "ResultingPhysicalStock", "SourceEffect", "InverseEffect")
            SELECT
                "OperationId", "LineNumber", "Ean13", "OperationType", "Quantity",
                "PreviousPhysicalStock", "CountedQuantity", "InventoryDifference",
                "ResultingPhysicalStock", "SourceEffect", "InverseEffect"
            FROM "__ef_temp_StockOperationLines";

            DROP TABLE "__ef_temp_StockOperationLines";
            ALTER TABLE "__ef_temp_StockOperationLines_Final" RENAME TO "StockOperationLines";
            CREATE INDEX "IX_StockOperationLines_Ean13" ON "StockOperationLines" ("Ean13");
            CREATE UNIQUE INDEX "IX_StockOperationLines_OperationId_Ean13" ON "StockOperationLines" ("OperationId", "Ean13");
            """);

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

        migrationBuilder.DropForeignKey(
            name: "FK_StockOperations_StockOperations_SourceOperationId",
            table: "StockOperations");
        migrationBuilder.DropIndex(
            name: "IX_StockOperations_SourceOperationId",
            table: "StockOperations");
        migrationBuilder.Sql("""
            CREATE TABLE "__ef_temp_StockOperationLines" (
                "OperationId" TEXT NOT NULL,
                "LineNumber" INTEGER NOT NULL,
                "Ean13" TEXT NOT NULL,
                "OperationType" TEXT NOT NULL DEFAULT 'INVENTORY',
                "Quantity" INTEGER NOT NULL,
                "PreviousPhysicalStock" INTEGER NOT NULL,
                "CountedQuantity" INTEGER NOT NULL,
                "InventoryDifference" INTEGER NOT NULL,
                "ResultingPhysicalStock" INTEGER NOT NULL,
                CONSTRAINT "PK_StockOperationLines" PRIMARY KEY ("OperationId", "LineNumber"),
                CONSTRAINT "CK_StockOperationLines_CountedQuantity_NonNegative" CHECK ("CountedQuantity" >= 0),
                CONSTRAINT "CK_StockOperationLines_InventoryDifference_Formula" CHECK ("InventoryDifference" = "CountedQuantity" - "PreviousPhysicalStock"),
                CONSTRAINT "CK_StockOperationLines_LineNumber_Positive" CHECK ("LineNumber" >= 1),
                CONSTRAINT "CK_StockOperationLines_OperationType_Valid" CHECK ("OperationType" IN ('supply', 'INVENTORY')),
                CONSTRAINT "CK_StockOperationLines_PreviousPhysicalStock_NonNegative" CHECK ("PreviousPhysicalStock" >= 0),
                CONSTRAINT "CK_StockOperationLines_Quantity_NonNegative" CHECK ("Quantity" >= 0),
                CONSTRAINT "CK_StockOperationLines_Quantity_PositiveForSupply" CHECK ("OperationType" <> 'supply' OR "Quantity" > 0),
                CONSTRAINT "CK_StockOperationLines_ResultingPhysicalStock_Formula" CHECK ("ResultingPhysicalStock" = "CountedQuantity"),
                CONSTRAINT "CK_StockOperationLines_ResultingPhysicalStock_NonNegative" CHECK ("ResultingPhysicalStock" >= 0),
                CONSTRAINT "FK_StockOperationLines_Articles_Ean13" FOREIGN KEY ("Ean13") REFERENCES "Articles" ("Ean13") ON DELETE RESTRICT,
                CONSTRAINT "FK_StockOperationLines_StockOperations_OperationId" FOREIGN KEY ("OperationId") REFERENCES "StockOperations" ("Id") ON DELETE CASCADE
            );

            INSERT INTO "__ef_temp_StockOperationLines" (
                "OperationId", "LineNumber", "Ean13", "OperationType", "Quantity",
                "PreviousPhysicalStock", "CountedQuantity", "InventoryDifference", "ResultingPhysicalStock")
            SELECT
                "OperationId", "LineNumber", "Ean13", "OperationType", "Quantity",
                "PreviousPhysicalStock", "CountedQuantity", "InventoryDifference", "ResultingPhysicalStock"
            FROM "StockOperationLines";

            DROP TABLE "StockOperationLines";
            ALTER TABLE "__ef_temp_StockOperationLines" RENAME TO "StockOperationLines";
            CREATE INDEX "IX_StockOperationLines_Ean13" ON "StockOperationLines" ("Ean13");
            CREATE UNIQUE INDEX "IX_StockOperationLines_OperationId_Ean13" ON "StockOperationLines" ("OperationId", "Ean13");
            """);
        migrationBuilder.DropColumn(name: "Justification", table: "StockOperations");
        migrationBuilder.DropColumn(name: "SourceOperationId", table: "StockOperations");
        migrationBuilder.DropColumn(name: "SourceOperationType", table: "StockOperations");
        migrationBuilder.DropColumn(name: "SourceEffect", table: "StockOperationLines");
        migrationBuilder.DropColumn(name: "InverseEffect", table: "StockOperationLines");
    }
}
