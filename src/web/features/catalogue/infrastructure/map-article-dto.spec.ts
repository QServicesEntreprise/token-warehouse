import { describe, expect, it } from 'vitest';
import { ArticleDto } from './dto/article.dto';
import { mapArticleDto } from './map-article-dto';

describe('mapArticleDto', () => {
  it('maps the HTTP representation to the Catalogue model', () => {
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
        taxRate: { code: 'REDUCED', ratio: '11/200', numerator: 11, denominator: 200 },
        vatCents: 55,
        priceTtcCents: 1055,
      }],
    };

    expect(mapArticleDto(dto)).toEqual({
      ...dto,
      consumptionModes: ['takeaway'],
      stock: { physicalQuantity: 4, sellableQuantity: 3 },
      priceQuotes: [{
        saleContext: 'takeaway',
        taxRate: { code: 'REDUCED', ratio: '11/200', numerator: 11, denominator: 200 },
        vatCents: 55,
        priceTtcCents: 1055,
      }],
    });
  });
});
