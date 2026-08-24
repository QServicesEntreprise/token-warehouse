import { StockAvailability } from './stock-availability';
import { StockBlockReason } from './stock-block-reason';

export interface StockPosition {
  ean13: string;
  name: string;
  physicalQuantity: number;
  sellableQuantity: number;
  blockedQuantity: number;
  availability: StockAvailability;
  blockReason: StockBlockReason | null;
}
