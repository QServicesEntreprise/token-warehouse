import { describe, expect, it } from 'vitest';
import { mapInventoryOperationDto } from './map-inventory-operation-dto';

describe('mapInventoryOperationDto', () => {
  it('restores every Inventory line with positions returned by the server', () => {
    expect(mapInventoryOperationDto({
      id: 'inventory-bulk-1',
      type: 'INVENTORY',
      ean13: '0123456789012',
      previousPhysicalStock: 5,
      countedQuantity: 11,
      inventoryDifference: 6,
      resultingPhysicalStock: 11,
      timestampUtc: '2030-01-15T10:00:00+00:00',
      lines: [{
        lineNumber: 1,
        ean13: '0123456789012',
        previousPhysicalStock: 5,
        countedQuantity: 11,
        inventoryDifference: 6,
        resultingPhysicalStock: 11,
      }],
    }, [{
      ean13: '0123456789012',
      name: 'Article inventorié',
      physicalQuantity: 11,
      sellableQuantity: 11,
      nonSellableQuantity: 0,
      availability: 'available',
      nonSellableReason: null,
    }])).toEqual({
      id: 'inventory-bulk-1',
      timestampUtc: '2030-01-15T10:00:00+00:00',
      lines: [{
        lineNumber: 1,
        ean13: '0123456789012',
        previousPhysicalStock: 5,
        countedQuantity: 11,
        inventoryDifference: 6,
        resultingPhysicalStock: 11,
        position: {
          ean13: '0123456789012',
          physicalQuantity: 11,
          sellableQuantity: 11,
          availability: 'available',
          nonSellableReason: null,
        },
      }],
    });
  });
});
