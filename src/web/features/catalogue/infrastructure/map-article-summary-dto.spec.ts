import { describe, expect, it } from 'vitest';
import { ArticleDto } from './dto/article.dto';
import { mapArticleSummaryDto } from './map-article-summary-dto';

describe('mapArticleSummaryDto', () => {
  it('keeps Catalogue fields and drops HTTP detail projections', () => {
    const dto: ArticleDto = {
      ean13: '0123456789012',
      type: 'food',
      name: 'Café test',
      priceHtCents: 1000,
      dlc: '2030-01-15',
      consumptionModes: ['takeaway'],
      isActive: true,
      status: 'active',
      stock: { physicalQuantity: 4, sellableQuantity: 3 },
      priceQuotes: [],
    };

    expect(mapArticleSummaryDto(dto)).toEqual({
      ean13: '0123456789012',
      type: 'food',
      name: 'Café test',
      priceHtCents: 1000,
      dlc: '2030-01-15',
      consumptionModes: ['takeaway'],
      status: 'active',
    });
  });
});
