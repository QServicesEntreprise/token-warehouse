import { describe, expect, it } from 'vitest';
import { mapRecordSupplyResponse } from './map-record-supply-response';

describe('mapRecordSupplyResponse', () => {
  it('maps the committed unit Approvisionnement without recalculating its position', () => {
    expect(mapRecordSupplyResponse({
      operation: {
        id: 'supply-1',
        type: 'supply',
        ean13: '0123456789012',
        quantity: 3,
        occurredAt: '2030-01-15T10:00:00Z',
      },
      position: {
        ean13: '0123456789012',
        name: 'Article reçu',
        type: 'food',
        isActive: true,
        status: 'active',
        physicalQuantity: 11,
        sellableQuantity: 7,
        availability: 'AVAILABLE',
        reason: null,
      },
    })).toEqual({
      operation: {
        id: 'supply-1',
        occurredAt: '2030-01-15T10:00:00Z',
        lines: [{ lineNumber: 1, ean13: '0123456789012', quantity: 3 }],
      },
      positions: [{
        ean13: '0123456789012',
        name: 'Article reçu',
        physicalQuantity: 11,
        sellableQuantity: 7,
        nonSellableQuantity: 4,
        availability: 'available',
        nonSellableReason: null,
      }],
    });
  });
});
