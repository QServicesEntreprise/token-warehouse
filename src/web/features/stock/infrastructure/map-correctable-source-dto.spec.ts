import { describe, expect, it } from 'vitest';
import { mapCorrectableSourceDto } from './map-correctable-source-dto';

describe('mapCorrectableSourceDto', () => {
  it('keeps the server financial snapshot unchanged', () => {
    expect(mapCorrectableSourceDto({
      id: 'sale-01',
      type: 'SALE',
      timestampUtc: '2030-01-15T09:00:00Z',
      ean13: '0123456789012',
      lines: [{ lineNumber: 1, ean13: '0123456789012', stockEffect: -3 }],
      financial: {
        context: 'takeaway',
        unitPriceHtCents: 1000,
        taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
        amountHtCents: 3000,
        vatCents: 165,
        amountTtcCents: 3165,
      },
    })).toEqual({
      id: 'sale-01',
      type: 'SALE',
      timestampUtc: '2030-01-15T09:00:00Z',
      ean13: '0123456789012',
      lines: [{ lineNumber: 1, ean13: '0123456789012', stockEffect: -3 }],
      financial: {
        context: 'takeaway',
        unitPriceHtCents: 1000,
        taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
        amountHtCents: 3000,
        vatCents: 165,
        amountTtcCents: 3165,
      },
    });
  });
});
