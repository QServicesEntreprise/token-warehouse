import { describe, expect, it } from 'vitest';
import { mapInventoryReceiptDto } from './map-inventory-receipt-dto';

describe('mapInventoryReceiptDto', () => {
  it('maps an Inventory receipt without recalculating the server result', () => {
    expect(mapInventoryReceiptDto({
      operation: {
        id: 'inventory-1',
        type: 'INVENTORY',
        ean13: '0123456789012',
        previousPhysicalStock: 5,
        countedQuantity: 11,
        inventoryDifference: 6,
        resultingPhysicalStock: 11,
        timestampUtc: '2030-01-15T10:00:00+00:00',
      },
      position: {
        ean13: '0123456789012',
        physicalStock: 11,
        sellableStock: 11,
        availability: 'AVAILABLE',
        reason: null,
      },
    })).toEqual({
      id: 'inventory-1',
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

  it('maps every server line from a bulk Inventory receipt', () => {
    expect(mapInventoryReceiptDto({
      operation: {
        id: 'inventory-bulk-1',
        type: 'INVENTORY',
        timestampUtc: '2030-01-15T10:00:00+00:00',
        lines: [{
          lineNumber: 2,
          ean13: '7351353713578',
          previousPhysicalStock: 5,
          countedQuantity: 2,
          inventoryDifference: -3,
          resultingPhysicalStock: 2,
          position: {
            ean13: '7351353713578',
            physicalStock: 2,
            sellableStock: 0,
            availability: 'NOT_SELLABLE',
            reason: 'UNSELLABLE_PACKAGING',
          },
        }],
      },
    })).toEqual({
      id: 'inventory-bulk-1',
      timestampUtc: '2030-01-15T10:00:00+00:00',
      lines: [{
        lineNumber: 2,
        ean13: '7351353713578',
        previousPhysicalStock: 5,
        countedQuantity: 2,
        inventoryDifference: -3,
        resultingPhysicalStock: 2,
        position: {
          ean13: '7351353713578',
          physicalQuantity: 2,
          sellableQuantity: 0,
          availability: 'notSellable',
          nonSellableReason: 'unsellablePackaging',
        },
      }],
    });
  });
});
