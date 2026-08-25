import type { SaleContext } from './sale-context';
import type { SaleTaxRate } from './sale-tax-rate';

export interface SaleQuote {
  saleContext?: SaleContext;
  taxRate: SaleTaxRate;
  vatCents: number;
  priceTtcCents: number;
}
