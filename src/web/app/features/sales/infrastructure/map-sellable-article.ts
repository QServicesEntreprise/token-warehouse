import { SellableArticle } from '../domain/sellable-article';
import { SellableArticleDto } from './sellable-article.dto';

export const mapSellableArticle = (dto: SellableArticleDto): SellableArticle => ({
  ...dto,
  priceQuotes: dto.priceQuotes ?? [],
});
