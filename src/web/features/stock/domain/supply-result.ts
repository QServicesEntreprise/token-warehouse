import type { StockPosition } from './stock-position';
import type { SupplyOperation } from './supply-operation';

export interface SupplyResult {
  operation: SupplyOperation;
  positions: readonly StockPosition[];
}
