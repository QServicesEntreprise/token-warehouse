export interface StockFailure {
  status?: number;
  code?: string;
  fieldErrors: Record<string, string[]>;
  title: string;
}
