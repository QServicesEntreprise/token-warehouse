import type { SaleFinancial } from './sale-financial';
import type { SaleOperation } from './sale-operation';
import type { SalePosition } from './sale-position';

export interface SaleResult {
  operation: SaleOperation;
  financial: SaleFinancial;
  position: SalePosition;
}
