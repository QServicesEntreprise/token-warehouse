import { StockPosition } from './stock-position';
import { SupplyOperation } from './supply-operation';

export interface SupplyResult {
  operation: SupplyOperation;
  positions: readonly StockPosition[];
}
