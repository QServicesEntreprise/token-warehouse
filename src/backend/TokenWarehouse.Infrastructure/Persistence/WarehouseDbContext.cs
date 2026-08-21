using Microsoft.EntityFrameworkCore;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class WarehouseDbContext(DbContextOptions<WarehouseDbContext> options) : DbContext(options)
{
    public DbSet<ArticleEntity> Articles => Set<ArticleEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var article = modelBuilder.Entity<ArticleEntity>();
        article.HasKey(entity => entity.Ean13);
        article.Property(entity => entity.Type).IsRequired();
        article.Property(entity => entity.Name).IsRequired();
        article.Property(entity => entity.NameSearchKey).IsRequired();
        article.Property(entity => entity.IsActive).IsRequired();
    }
}
