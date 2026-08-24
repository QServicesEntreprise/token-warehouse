import { StockAvailability } from './stock-availability';
import { StockNonSellableReason } from './stock-non-sellable-reason';

export interface StockPosition {
  ean13: string;
  name: string;
  physicalQuantity: number;
  sellableQuantity: number;
  nonSellableQuantity: number;
  availability: StockAvailability;
  nonSellableReason: StockNonSellableReason | null;
}
