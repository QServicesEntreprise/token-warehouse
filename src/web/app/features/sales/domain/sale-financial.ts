import { SaleContext } from './sale-context';
import { SaleTaxRate } from './sale-tax-rate';

export interface SaleFinancial {
  context: SaleContext | null;
  unitPriceHtCents: number;
  taxRate: SaleTaxRate;
  amountHtCents: number;
  vatCents: number;
  amountTtcCents: number;
}
