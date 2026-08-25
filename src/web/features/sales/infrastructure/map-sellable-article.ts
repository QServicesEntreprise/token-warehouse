import type { SellableArticle } from '../domain/sellable-article';
import type { SellableArticleDto } from './sellable-article.dto';

export const mapSellableArticle = (dto: SellableArticleDto): SellableArticle => ({
  ...dto,
  priceQuotes: dto.priceQuotes ?? [],
});
