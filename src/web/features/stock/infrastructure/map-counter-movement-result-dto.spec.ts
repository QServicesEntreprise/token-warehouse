import { describe, expect, it } from 'vitest';
import { mapCounterMovementResultDto } from './map-counter-movement-result-dto';

describe('mapCounterMovementResultDto', () => {
  it('keeps the committed Stock and financial result returned by the server', () => {
    expect(mapCounterMovementResultDto({
      counterMovement: {
        id: 'counter-01',
        type: 'COUNTER_MOVEMENT',
        timestampUtc: '2030-01-15T10:00:00Z',
        sourceOperationId: 'sale-01',
        sourceOperationType: 'SALE',
        justification: 'Erreur de saisie',
        lines: [{ lineNumber: 1, ean13: '0123456789012', sourceEffect: -3, inverseEffect: 3 }],
      },
      source: {
        id: 'sale-01',
        type: 'SALE',
        timestampUtc: '2030-01-15T09:00:00Z',
        ean13: '0123456789012',
        lines: [{ lineNumber: 1, ean13: '0123456789012', stockEffect: -3 }],
      },
      positions: [{
        ean13: '0123456789012',
        physicalStock: 5,
        sellableStock: 0,
        availability: 'NOT_SELLABLE',
        reason: 'ARCHIVED',
      }],
      financialReversal: {
        sourceOperationId: 'sale-01',
        context: 'takeaway',
        unitPriceHtCents: 100,
        taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
        amountHtCents: -300,
        vatCents: -17,
        amountTtcCents: -317,
      },
    })).toMatchObject({
      positions: [{
        physicalQuantity: 5,
        sellableQuantity: 0,
        availability: 'notSellable',
        nonSellableReason: 'archived',
      }],
      financialReversal: {
        unitPriceHtCents: 100,
        amountHtCents: -300,
        vatCents: -17,
        amountTtcCents: -317,
      },
    });
  });
});
