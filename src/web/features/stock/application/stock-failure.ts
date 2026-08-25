export interface StockFailure {
  status?: number | undefined;
  code?: string | undefined;
  fieldErrors: Record<string, string[]>;
  title: string;
}
