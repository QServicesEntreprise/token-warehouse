import { describe, expect, it } from 'vitest';
import { mapSellableArticle } from './map-sellable-article';

describe('mapSellableArticle', () => {
  it('creates an autonomous sales projection from the HTTP DTO', () => {
    const article = mapSellableArticle({
      ean13: '0123456789012',
      name: 'Article vendable',
      type: 'food',
      isActive: true,
      status: 'active',
      priceHtCents: 101,
      physicalQuantity: 8,
      sellableQuantity: 8,
      availability: 'AVAILABLE',
      reason: null,
      consumptionModes: ['takeaway'],
      priceQuotes: [{
        saleContext: 'takeaway',
        taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
        vatCents: 6,
        priceTtcCents: 107,
      }],
    });

    expect(article).toEqual(expect.objectContaining({
      ean13: '0123456789012',
      priceHtCents: 101,
      physicalQuantity: 8,
      sellableQuantity: 8,
      priceQuotes: [expect.objectContaining({ priceTtcCents: 107 })],
    }));
  });
});
