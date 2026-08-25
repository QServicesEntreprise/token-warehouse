import type { Article } from '../domain/article';
import type { ArticleDto } from './dto/article.dto';

export const mapArticleDto = (dto: ArticleDto): Article => {
  const base = {
    ean13: dto.ean13,
    name: dto.name,
    priceHtCents: dto.priceHtCents,
    status: dto.status,
    priceQuotes: (dto.priceQuotes ?? []).map((quote) => ({ ...quote, taxRate: { ...quote.taxRate } })),
    ...(dto.stock ? { stock: { ...dto.stock } } : {}),
  };
  if (dto.type === 'food') {
    if (!dto.dlc || !dto.consumptionModes?.length) throw new Error('Invalid food Article DTO.');
    return { ...base, type: 'food', dlc: dto.dlc, consumptionModes: [...dto.consumptionModes] };
  }
  if (!dto.packaging) throw new Error('Invalid non-food Article DTO.');
  return { ...base, type: 'nonFood', packaging: dto.packaging };
};
