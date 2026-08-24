export interface InventoryReceiptDto {
  operation: {
    id: string;
    type: 'INVENTORY';
    ean13: string;
    previousPhysicalStock: number;
    countedQuantity: number;
    inventoryDifference: number;
    resultingPhysicalStock: number;
    timestampUtc: string;
  } | {
    id: string;
    type: 'INVENTORY';
    timestampUtc: string;
    lines: {
      lineNumber: number;
      ean13: string;
      previousPhysicalStock: number;
      countedQuantity: number;
      inventoryDifference: number;
      resultingPhysicalStock: number;
      position: {
        ean13: string;
        physicalStock: number;
        sellableStock: number;
        availability: 'AVAILABLE' | 'OUT_OF_STOCK' | 'NOT_SELLABLE';
        reason: 'ARCHIVED' | 'DLC_EXPIRED' | 'UNSELLABLE_PACKAGING' | null;
      };
    }[];
  };
  position?: {
    ean13: string;
    physicalStock: number;
    sellableStock: number;
    availability: 'AVAILABLE' | 'OUT_OF_STOCK' | 'NOT_SELLABLE';
    reason: 'ARCHIVED' | 'DLC_EXPIRED' | 'UNSELLABLE_PACKAGING' | null;
  };
}
