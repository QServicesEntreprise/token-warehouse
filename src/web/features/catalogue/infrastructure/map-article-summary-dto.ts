import type { ArticleSummary } from '../domain/article-summary';
import type { ArticleDto } from './dto/article.dto';
import { mapArticleDto } from './map-article-dto';

export const mapArticleSummaryDto = (dto: ArticleDto): ArticleSummary => {
  const article = mapArticleDto(dto);
  const base = {
    ean13: article.ean13,
    name: article.name,
    priceHtCents: article.priceHtCents,
    status: article.status,
    priceQuotes: article.priceQuotes,
  };
  return article.type === 'food'
    ? { ...base, type: 'food', dlc: article.dlc, consumptionModes: [...article.consumptionModes] }
    : { ...base, type: 'nonFood', packaging: article.packaging };
};
