using Microsoft.EntityFrameworkCore;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class WarehouseDbContext(DbContextOptions<WarehouseDbContext> options) : DbContext(options)
{
    public DbSet<ArticleEntity> Articles => Set<ArticleEntity>();

    public DbSet<ArticleLifecycleHistoryEntity> ArticleLifecycleHistory => Set<ArticleLifecycleHistoryEntity>();

    public DbSet<StockPositionEntity> StockPositions => Set<StockPositionEntity>();

    public DbSet<StockOperationEntity> StockOperations => Set<StockOperationEntity>();

    public DbSet<StockOperationLineEntity> StockOperationLines => Set<StockOperationLineEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var article = modelBuilder.Entity<ArticleEntity>();
        article.HasKey(entity => entity.Ean13);
        article.Property(entity => entity.Type).IsRequired();
        article.Property(entity => entity.Name).IsRequired();
        article.Property(entity => entity.NameSearchKey).IsRequired();
        article.Property(entity => entity.IsActive).IsRequired();
        article.Property(entity => entity.IsActive).IsConcurrencyToken();
        article.Property(entity => entity.Version).IsRequired();
        article.Property(entity => entity.Version).IsConcurrencyToken();

        var history = modelBuilder.Entity<ArticleLifecycleHistoryEntity>();
        history.HasKey(entity => entity.Id);
        history.HasIndex(entity => new { entity.OccurredAt, entity.Id });
        history.Property(entity => entity.Ean13).IsRequired();
        history.Property(entity => entity.PreviousStatus).IsRequired();
        history.Property(entity => entity.NextStatus).IsRequired();
        history.Property(entity => entity.OccurredAt).IsRequired();
        history.Property(entity => entity.Kind).IsRequired();
        history.HasOne<ArticleEntity>()
            .WithMany()
            .HasForeignKey(entity => entity.Ean13)
            .OnDelete(DeleteBehavior.Restrict);

        var stock = modelBuilder.Entity<StockPositionEntity>();
        stock.HasKey(entity => entity.Ean13);
        stock.Property(entity => entity.PhysicalQuantity).IsRequired();
        stock.Property(entity => entity.Version).IsRequired();
        stock.Property(entity => entity.Version).IsConcurrencyToken();
        stock.ToTable("StockPositions", table => table.HasCheckConstraint(
            "CK_StockPositions_PhysicalQuantity_NonNegative",
            "PhysicalQuantity >= 0"));
        stock.HasOne<ArticleEntity>()
            .WithMany()
            .HasForeignKey(entity => entity.Ean13)
            .OnDelete(DeleteBehavior.Restrict);

        var operation = modelBuilder.Entity<StockOperationEntity>();
        operation.HasKey(entity => entity.Id);
        operation.Property(entity => entity.Type).IsRequired();
        operation.Property(entity => entity.Ean13).IsRequired();
        operation.Property(entity => entity.Quantity).IsRequired();
        operation.Property(entity => entity.OccurredAt).IsRequired();
        operation.Property(entity => entity.PreviousPhysicalStock).IsRequired();
        operation.Property(entity => entity.CountedQuantity).IsRequired();
        operation.Property(entity => entity.InventoryDifference).IsRequired();
        operation.Property(entity => entity.ResultingPhysicalStock).IsRequired();
        operation.Property(entity => entity.TimestampUtc).IsRequired();
        operation.Property(entity => entity.SourceOperationId);
        operation.Property(entity => entity.SourceOperationType);
        operation.Property(entity => entity.Justification);
        operation.HasIndex(entity => entity.Ean13);
        operation.HasIndex(entity => new { entity.TimestampUtc, entity.Id });
        operation.HasIndex(entity => entity.SourceOperationId).IsUnique();
        operation.ToTable("StockOperations", table =>
        {
            table.HasCheckConstraint(
                "CK_StockOperations_Quantity_Positive",
                "Type <> 'supply' OR Quantity > 0");
            table.HasCheckConstraint(
                "CK_StockOperations_PreviousPhysicalStock_NonNegative",
                "PreviousPhysicalStock >= 0");
            table.HasCheckConstraint(
                "CK_StockOperations_CountedQuantity_NonNegative",
                "CountedQuantity >= 0");
            table.HasCheckConstraint(
                "CK_StockOperations_ResultingPhysicalStock_NonNegative",
                "ResultingPhysicalStock >= 0");
            table.HasCheckConstraint(
                "CK_StockOperations_InventoryDifference_Formula",
                "Type <> 'INVENTORY' OR InventoryDifference = CountedQuantity - PreviousPhysicalStock");
            table.HasCheckConstraint(
                "CK_StockOperations_ResultingPhysicalStock_Formula",
                "Type <> 'INVENTORY' OR ResultingPhysicalStock = CountedQuantity");
            table.HasCheckConstraint(
                "CK_StockOperations_CounterMovement_Fields",
                "Type <> 'COUNTER_MOVEMENT' OR (SourceOperationId IS NOT NULL AND length(trim(SourceOperationId)) > 0 AND SourceOperationType IS NOT NULL AND SourceOperationType IN ('SUPPLY', 'INVENTORY', 'SALE') AND Justification IS NOT NULL AND length(trim(Justification)) > 0)");
        });
        operation.HasOne<ArticleEntity>()
            .WithMany()
            .HasForeignKey(entity => entity.Ean13)
            .OnDelete(DeleteBehavior.Restrict);
        operation.HasOne<StockOperationEntity>()
            .WithMany()
            .HasForeignKey(entity => entity.SourceOperationId)
            .OnDelete(DeleteBehavior.Restrict);

        var operationLine = modelBuilder.Entity<StockOperationLineEntity>();
        operationLine.HasKey(entity => new { entity.OperationId, entity.LineNumber });
        operationLine.Property(entity => entity.Ean13).IsRequired();
        operationLine.Property(entity => entity.OperationType)
            .IsRequired()
            .HasDefaultValue("INVENTORY");
        operationLine.Property(entity => entity.Quantity).IsRequired();
        operationLine.Property(entity => entity.PreviousPhysicalStock).IsRequired();
        operationLine.Property(entity => entity.CountedQuantity).IsRequired();
        operationLine.Property(entity => entity.InventoryDifference).IsRequired();
        operationLine.Property(entity => entity.ResultingPhysicalStock).IsRequired();
        operationLine.Property(entity => entity.SourceEffect).IsRequired();
        operationLine.Property(entity => entity.InverseEffect).IsRequired();
        operationLine.HasIndex(entity => new { entity.OperationId, entity.Ean13 }).IsUnique();
        operationLine.ToTable("StockOperationLines", table =>
        {
            table.HasCheckConstraint(
                "CK_StockOperationLines_LineNumber_Positive",
                "LineNumber >= 1");
            table.HasCheckConstraint(
                "CK_StockOperationLines_OperationType_Valid",
                "OperationType IN ('supply', 'INVENTORY', 'SALE', 'COUNTER_MOVEMENT')");
            table.HasCheckConstraint(
                "CK_StockOperationLines_Quantity_NonNegative",
                "Quantity >= 0");
            table.HasCheckConstraint(
                "CK_StockOperationLines_Quantity_PositiveForSupply",
                "OperationType <> 'supply' OR Quantity > 0");
            table.HasCheckConstraint(
                "CK_StockOperationLines_PreviousPhysicalStock_NonNegative",
                "PreviousPhysicalStock >= 0");
            table.HasCheckConstraint(
                "CK_StockOperationLines_CountedQuantity_NonNegative",
                "CountedQuantity >= 0");
            table.HasCheckConstraint(
                "CK_StockOperationLines_ResultingPhysicalStock_NonNegative",
                "ResultingPhysicalStock >= 0");
            table.HasCheckConstraint(
                "CK_StockOperationLines_InventoryDifference_Formula",
                "OperationType <> 'INVENTORY' OR InventoryDifference = CountedQuantity - PreviousPhysicalStock");
            table.HasCheckConstraint(
                "CK_StockOperationLines_ResultingPhysicalStock_Formula",
                "OperationType <> 'INVENTORY' OR ResultingPhysicalStock = CountedQuantity");
            table.HasCheckConstraint(
                "CK_StockOperationLines_CounterMovement_Inverse",
                "OperationType <> 'COUNTER_MOVEMENT' OR InverseEffect = -SourceEffect");
        });
        operationLine.HasOne(entity => entity.Operation)
            .WithMany(operation => operation.Lines)
            .HasForeignKey(entity => entity.OperationId)
            .OnDelete(DeleteBehavior.Cascade);
        operationLine.HasOne<ArticleEntity>()
            .WithMany()
            .HasForeignKey(entity => entity.Ean13)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
