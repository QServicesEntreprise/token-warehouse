using Microsoft.EntityFrameworkCore;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class WarehouseDbContext(DbContextOptions<WarehouseDbContext> options) : DbContext(options)
{
    public DbSet<ArticleEntity> Articles => Set<ArticleEntity>();

    public DbSet<ArticleLifecycleHistoryEntity> ArticleLifecycleHistory => Set<ArticleLifecycleHistoryEntity>();

    public DbSet<StockPositionEntity> StockPositions => Set<StockPositionEntity>();

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
        stock.ToTable("StockPositions", table => table.HasCheckConstraint(
            "CK_StockPositions_PhysicalQuantity_NonNegative",
            "PhysicalQuantity >= 0"));
        stock.HasOne<ArticleEntity>()
            .WithMany()
            .HasForeignKey(entity => entity.Ean13)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
