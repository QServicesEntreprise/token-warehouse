import { describe, expect, it } from 'vitest';
import { mapSaleCommand } from './map-sale-command';

describe('mapSaleCommand', () => {
  it('omits an absent context and preserves an explicit one', () => {
    expect(mapSaleCommand({ ean13: '0123456789012', quantity: 2 })).toEqual({
      ean13: '0123456789012',
      quantity: 2,
    });
    expect(mapSaleCommand({ ean13: '0123456789012', quantity: 2, context: 'onsite' })).toEqual({
      ean13: '0123456789012',
      quantity: 2,
      context: 'onsite',
    });
  });
});
