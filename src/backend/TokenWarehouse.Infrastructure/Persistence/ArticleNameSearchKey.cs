using System.Text;

namespace TokenWarehouse.Infrastructure.Persistence;

internal static class ArticleNameSearchKey
{
    public static string From(string value)
        => value.Normalize(NormalizationForm.FormC).ToUpperInvariant();
}
