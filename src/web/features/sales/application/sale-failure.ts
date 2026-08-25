export interface SaleFailure {
  kind: 'validation' | 'conflict' | 'error';
  message?: string | undefined;
  fieldErrors?: Record<string, string>;
}
