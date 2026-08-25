import { describe, expect, it } from 'vitest';
import type { ArticleDto } from './dto/article.dto';
import { mapArticleSummaryDto } from './map-article-summary-dto';

describe('mapArticleSummaryDto', () => {
  it('keeps Catalogue fields and reuses the detail price quotes', () => {
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
      priceQuotes: [{
        saleContext: 'takeaway',
        taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
        vatCents: 55,
        priceTtcCents: 1055,
      }],
    };

    expect(mapArticleSummaryDto(dto)).toEqual({
      ean13: '0123456789012',
      type: 'food',
      name: 'Café test',
      priceHtCents: 1000,
      dlc: '2030-01-15',
      consumptionModes: ['takeaway'],
      status: 'active',
      priceQuotes: [{
        saleContext: 'takeaway',
        taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
        vatCents: 55,
        priceTtcCents: 1055,
      }],
    });
  });
});
