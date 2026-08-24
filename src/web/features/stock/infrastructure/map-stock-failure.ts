import { HttpErrorResponse } from '@angular/common/http';
import { StockFailure } from '../application/stock-failure';

export const mapStockFailure = (error: unknown, fallback: string): StockFailure => {
  const dto = error instanceof HttpErrorResponse && typeof error.error === 'object' && error.error !== null
    ? error.error as { code?: string; errors?: Record<string, string[]>; title?: string }
    : {};
  return {
    status: error instanceof HttpErrorResponse ? error.status : undefined,
    code: dto.code,
    fieldErrors: dto.errors ?? {},
    title: dto.title ?? fallback,
  };
};
