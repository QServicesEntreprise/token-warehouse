import { describe, expect, it } from 'vitest';
import { mapSaleResult } from './map-sale-result';

describe('mapSaleResult', () => {
  it('preserves the financial snapshot returned by the server', () => {
    const result = mapSaleResult({
      operation: {
        id: 'sale-1',
        type: 'SALE',
        ean13: '0123456789012',
        quantity: 3,
        occurredAt: '2030-01-15T10:00:00+00:00',
      },
      financial: {
        context: 'onsite',
        unitPriceHtCents: 101,
        taxRate: { code: 'onsite', ratio: '1/10', numerator: 1, denominator: 10 },
        amountHtCents: 303,
        vatCents: 30,
        amountTtcCents: 333,
      },
      position: {
        ean13: '0123456789012',
        name: 'Article vendu',
        type: 'food',
        isActive: true,
        status: 'active',
        physicalQuantity: 5,
        sellableQuantity: 5,
        availability: 'AVAILABLE',
        reason: null,
        dlc: '2030-01-20',
        consumptionModes: ['onsite'],
      },
    });

    expect(result.financial).toEqual({
      context: 'onsite',
      unitPriceHtCents: 101,
      taxRate: { code: 'onsite', ratio: '1/10', numerator: 1, denominator: 10 },
      amountHtCents: 303,
      vatCents: 30,
      amountTtcCents: 333,
    });
  });
});
