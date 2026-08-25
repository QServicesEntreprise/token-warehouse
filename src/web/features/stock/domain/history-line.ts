export interface HistoryLine {
  lineNumber: number;
  ean13: string;
  quantity?: number | undefined;
  previousPhysicalStock?: number | undefined;
  countedQuantity?: number | undefined;
  difference?: number | undefined;
  stockEffect?: number | undefined;
  inverseEffect?: number | undefined;
  resultingPhysicalStock?: number | undefined;
}
