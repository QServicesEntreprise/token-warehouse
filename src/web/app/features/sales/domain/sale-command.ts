import { SaleContext } from './sale-context';

export interface SaleCommand {
  ean13: string;
  quantity: number;
  context?: SaleContext;
}
