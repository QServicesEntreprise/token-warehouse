import { SaleContext } from './sale-context';
import { SaleTaxRate } from './sale-tax-rate';

export interface SaleQuote {
  saleContext?: SaleContext;
  taxRate: SaleTaxRate;
  vatCents: number;
  priceTtcCents: number;
}
