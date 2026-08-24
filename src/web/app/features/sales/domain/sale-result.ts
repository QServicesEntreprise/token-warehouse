import { SaleFinancial } from './sale-financial';
import { SaleOperation } from './sale-operation';
import { SalePosition } from './sale-position';

export interface SaleResult {
  operation: SaleOperation;
  financial: SaleFinancial;
  position: SalePosition;
}
