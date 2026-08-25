import type { SaleContext } from './sale-context';
import type { SaleTaxRate } from './sale-tax-rate';

export interface SaleFinancial {
  context: SaleContext | null;
  unitPriceHtCents: number;
  taxRate: SaleTaxRate;
  amountHtCents: number;
  vatCents: number;
  amountTtcCents: number;
}
