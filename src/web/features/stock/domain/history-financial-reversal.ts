import type { HistoryFinancial } from './history-financial';

export interface HistoryFinancialReversal extends HistoryFinancial {
  sourceOperationId: string;
}
