import { describe, expect, it } from 'vitest';
import { mapHistoryEntryDto } from './map-history-entry-dto';

describe('mapHistoryEntryDto', () => {
  it('maps a financial counter-movement into the Stock History model', () => {
    expect(mapHistoryEntryDto({
      id: 'counter-1',
      type: 'COUNTER_MOVEMENT',
      timestampUtc: '2030-01-15T10:01:00Z',
      ean13: '0123456789012',
      articles: [{ ean13: '0123456789012' }],
      lines: [{
        lineNumber: 1,
        ean13: '0123456789012',
        inverseEffect: 2,
        resultingPhysicalStock: 5,
      }],
      sourceOperationId: 'sale-1',
      sourceOperationType: 'SALE_STOCK',
      justification: 'Correction',
      financialReversal: {
        sourceOperationId: 'sale-1',
        context: 'takeaway',
        unitPriceHtCents: 100,
        taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
        amountHtCents: -200,
        vatCents: -11,
        amountTtcCents: -211,
      },
    })).toMatchObject({
      id: 'counter-1',
      type: 'counterMovement',
      timestampUtc: '2030-01-15T10:01:00Z',
      ean13: '0123456789012',
      articles: ['0123456789012'],
      lines: [{
        lineNumber: 1,
        ean13: '0123456789012',
        inverseEffect: 2,
        resultingPhysicalStock: 5,
      }],
      sourceOperationId: 'sale-1',
      sourceOperationType: 'SALE_STOCK',
      justification: 'Correction',
      financialReversal: {
        sourceOperationId: 'sale-1',
        context: 'takeaway',
        unitPriceHtCents: 100,
        taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
        amountHtCents: -200,
        vatCents: -11,
        amountTtcCents: -211,
      },
    });
  });

  it.each([
    ['SUPPLY', 'supply'],
    ['INVENTORY', 'inventory'],
    ['SALE_STOCK', 'saleStock'],
    ['COUNTER_MOVEMENT', 'counterMovement'],
    ['CATALOG_ARCHIVE', 'catalogArchive'],
    ['CATALOG_REACTIVATE', 'catalogReactivate'],
    ['CATALOG_DLC_CHANGE', 'catalogDlcChange'],
    ['CATALOG_PACKAGING_CHANGE', 'catalogPackagingChange'],
    ['CATALOG_ATTRIBUTE_CHANGE', 'catalogAttributeChange'],
    ['FUTURE_FACT', 'unknown'],
  ] as const)('maps %s safely to %s', (type, expected) => {
    const entry = mapHistoryEntryDto({
      id: 'fact-1',
      type,
      timestampUtc: '2030-01-15T10:00:00Z',
      ean13: '0123456789012',
      articles: [{ ean13: '0123456789012' }],
      lines: [],
    });

    expect(entry.type).toBe(expected);
    if (entry.type === 'unknown') expect(entry.sourceType).toBe('FUTURE_FACT');
  });

  it('normalizes legacy change value names at the HTTP boundary', () => {
    expect(mapHistoryEntryDto({
      id: 'change-1',
      type: 'CATALOG_ATTRIBUTE_CHANGE',
      timestampUtc: '2030-01-15T10:00:00Z',
      ean13: '0123456789012',
      articles: [{ ean13: '0123456789012' }],
      lines: [],
      changes: [{ field: 'Nom', previousValue: 'Avant', nextValue: 'Après' }],
    })).toMatchObject({
      type: 'catalogAttributeChange',
      changes: [{ field: 'Nom', before: 'Avant', after: 'Après' }],
    });
  });
});
