export interface SaleFailure {
  kind: 'validation' | 'conflict' | 'error';
  message?: string;
  fieldErrors?: Record<string, string>;
}
