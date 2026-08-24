import { ArticleSummary } from '../domain/article-summary';
import { ArticleDto } from './dto/article.dto';

export const mapArticleSummaryDto = (dto: ArticleDto): ArticleSummary => {
  const { priceQuotes: _, stock: __, ...summary } = dto;
  return {
    ...summary,
    consumptionModes: summary.consumptionModes ? [...summary.consumptionModes] : undefined,
  };
};
