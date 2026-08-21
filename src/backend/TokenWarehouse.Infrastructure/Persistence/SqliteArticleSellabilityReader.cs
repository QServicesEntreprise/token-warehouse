using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Infrastructure.Persistence;

public sealed class SqliteArticleSellabilityReader(IArticleStore articleStore)
    : IArticleSellabilityReader
{
    public async ValueTask<IReadOnlyList<ArticleSellabilitySnapshot>> ListAsync(
        CancellationToken cancellationToken = default)
    {
        var articles = await articleStore.ListAsync(
            new ArticleListFilter(ArticleLifecycleFilter.All, null, null, null, null),
            cancellationToken);

        return articles.Select(ArticleSellabilitySnapshot.From).ToArray();
    }

    public async ValueTask<ArticleSellabilitySnapshot?> FindByEanAsync(
        Ean13 ean13,
        CancellationToken cancellationToken = default)
    {
        var article = await articleStore.FindByEanAsync(ean13, cancellationToken);
        return article is null ? null : ArticleSellabilitySnapshot.From(article);
    }
}
