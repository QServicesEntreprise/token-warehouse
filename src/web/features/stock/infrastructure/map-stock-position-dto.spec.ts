import { describe, expect, it } from 'vitest';
import { mapStockPositionDto } from './map-stock-position-dto';

describe('mapStockPositionDto', () => {
  it('maps the HTTP vocabulary to a Stock position', () => {
    expect(mapStockPositionDto({
      ean13: '0123456789012',
      name: 'Article bloqué',
      type: 'food',
      isActive: true,
      status: 'active',
      physicalQuantity: 7,
      sellableQuantity: 0,
      availability: 'NOT_SELLABLE',
      reason: 'DLC_EXPIRED',
      dlc: '2030-01-14',
      consumptionModes: ['takeaway'],
    })).toEqual({
      ean13: '0123456789012',
      name: 'Article bloqué',
      physicalQuantity: 7,
      sellableQuantity: 0,
      nonSellableQuantity: 7,
      availability: 'notSellable',
      nonSellableReason: 'dlcExpired',
    });
  });

  it('rejects an unknown availability at the HTTP boundary', () => {
    expect(() => mapStockPositionDto({
      ean13: '0123456789012',
      name: 'Article inconnu',
      type: 'food',
      isActive: true,
      status: 'active',
      physicalQuantity: 0,
      sellableQuantity: 0,
      availability: 'UNKNOWN' as 'AVAILABLE',
      reason: null,
    })).toThrow('Disponibilité Stock inconnue');
  });

  it('rejects an unknown non-sellability reason at the HTTP boundary', () => {
    expect(() => mapStockPositionDto({
      ean13: '0123456789012',
      name: 'Article inconnu',
      type: 'food',
      isActive: true,
      status: 'active',
      physicalQuantity: 1,
      sellableQuantity: 0,
      availability: 'NOT_SELLABLE',
      reason: 'UNKNOWN' as 'ARCHIVED',
    })).toThrow('Raison de non-vendabilité inconnue');
  });
});
