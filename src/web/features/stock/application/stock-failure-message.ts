import type { StockFailure } from './stock-failure';

export const stockFailureMessage = (error: unknown, fallback: string): string => (
  isStockFailure(error) ? error.title : fallback
);

const isStockFailure = (error: unknown): error is StockFailure => (
  typeof error === 'object'
  && error !== null
  && 'title' in error
  && typeof error.title === 'string'
);
