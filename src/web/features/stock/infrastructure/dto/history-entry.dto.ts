interface HistoryArticleDto {
  ean13: string;
}

interface HistoryLineDto {
  lineNumber: number;
  ean13: string;
  quantity?: number;
  previousPhysicalStock?: number;
  countedQuantity?: number;
  difference?: number;
  stockEffect?: number;
  inverseEffect?: number;
  resultingPhysicalStock?: number;
}

interface HistoryChangeDto {
  field: string;
  before?: string;
  after?: string;
  previousValue?: string;
  nextValue?: string;
}

interface HistoryFinancialDto {
  context: 'takeaway' | 'onsite' | null;
  unitPriceHtCents: number;
  taxRate: { code: string; ratio: string; numerator: number; denominator: number };
  amountHtCents: number;
  vatCents: number;
  amountTtcCents: number;
}

export interface HistoryEntryDto {
  id: string;
  type: string;
  timestampUtc: string;
  ean13: string;
  articles: HistoryArticleDto[];
  quantity?: number;
  stockEffect?: number;
  previousPhysicalStock?: number;
  countedQuantity?: number;
  difference?: number;
  resultingPhysicalStock?: number;
  lines: HistoryLineDto[];
  sourceOperationId?: string;
  sourceOperationType?: string;
  justification?: string;
  financial?: HistoryFinancialDto;
  financialReversal?: HistoryFinancialDto & { sourceOperationId: string };
  correctedByOperationId?: string;
  correctionOperationId?: string;
  previousStatus?: string;
  nextStatus?: string;
  kind?: string;
  changes?: HistoryChangeDto[];
}
