export interface HistoryLine {
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
