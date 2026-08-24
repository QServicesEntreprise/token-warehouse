import { Article } from '../domain/article';
import { ArticleDto } from './dto/article.dto';

export const mapArticleDto = (dto: ArticleDto): Article => ({
  ...dto,
  consumptionModes: dto.consumptionModes ? [...dto.consumptionModes] : undefined,
  priceQuotes: (dto.priceQuotes ?? []).map((quote) => ({ ...quote, taxRate: { ...quote.taxRate } })),
  stock: dto.stock ? { ...dto.stock } : undefined,
});
