using Microsoft.EntityFrameworkCore;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class WarehouseDbContext(DbContextOptions<WarehouseDbContext> options) : DbContext(options)
{
    public DbSet<ArticleEntity> Articles => Set<ArticleEntity>();

    public DbSet<ArticleLifecycleHistoryEntity> ArticleLifecycleHistory => Set<ArticleLifecycleHistoryEntity>();

    public DbSet<StockPositionEntity> StockPositions => Set<StockPositionEntity>();

    public DbSet<StockOperationEntity> StockOperations => Set<StockOperationEntity>();

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
        operation.Property(entity => entity.PreviousPhysicalStock).IsRequired();
        operation.Property(entity => entity.CountedQuantity).IsRequired();
        operation.Property(entity => entity.InventoryDifference).IsRequired();
        operation.Property(entity => entity.ResultingPhysicalStock).IsRequired();
        operation.Property(entity => entity.TimestampUtc).IsRequired();
        operation.HasIndex(entity => entity.Ean13);
        operation.ToTable("StockOperations", table =>
        {
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
                "InventoryDifference = CountedQuantity - PreviousPhysicalStock");
            table.HasCheckConstraint(
                "CK_StockOperations_ResultingPhysicalStock_Formula",
                "ResultingPhysicalStock = CountedQuantity");
        });
        operation.HasOne<ArticleEntity>()
            .WithMany()
            .HasForeignKey(entity => entity.Ean13)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
