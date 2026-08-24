import { HistoryTaxRate } from './history-tax-rate';

export interface HistoryFinancial {
  context: 'takeaway' | 'onsite' | null;
  unitPriceHtCents: number;
  taxRate: HistoryTaxRate;
  amountHtCents: number;
  vatCents: number;
  amountTtcCents: number;
}
