import type { StockAvailability } from './stock-availability';
import type { StockNonSellableReason } from './stock-non-sellable-reason';

export interface InventoryReceipt {
  id: string;
  timestampUtc: string;
  lines: readonly {
    lineNumber: number;
    ean13: string;
    previousPhysicalStock: number;
    countedQuantity: number;
    inventoryDifference: number;
    resultingPhysicalStock: number;
    position: {
      ean13: string;
      physicalQuantity: number;
      sellableQuantity: number;
      availability: StockAvailability;
      nonSellableReason: StockNonSellableReason | null;
    };
  }[];
}
