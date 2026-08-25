import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { catchError, map, throwError } from 'rxjs';
import type { Observable } from 'rxjs';
import type { SaleFailure } from '../application/sale-failure';
import type { SalesGateway } from '../application/sales-gateway';
import type { SaleCommand } from '../domain/sale-command';
import type { SaleResult } from '../domain/sale-result';
import type { SellableArticle } from '../domain/sellable-article';
import { mapSaleCommand } from './map-sale-command';
import { mapSaleResult } from './map-sale-result';
import { mapSellableArticle } from './map-sellable-article';
import type { SaleResultDto } from './sale-result.dto';
import type { SellableArticleDto } from './sellable-article.dto';

const mapFailure = (error: unknown): SaleFailure => {
  if (!(error instanceof HttpErrorResponse)) {
    return { kind: 'error' };
  }
  const problem = typeof error.error === 'object' && error.error !== null
    ? error.error as { title?: string; errors?: Record<string, string[]> }
    : {};
  return {
    kind: error.status === 400 ? 'validation' : error.status === 409 ? 'conflict' : 'error',
    message: problem.title,
    fieldErrors: Object.fromEntries(
      Object.entries(problem.errors ?? {}).map(([field, messages]) => [field, messages[0] ?? 'Valeur invalide.']),
    ),
  };
};

@Injectable()
export class HttpSalesGateway implements SalesGateway {
  private readonly http = inject(HttpClient);

  searchArticles(search: string): Observable<SellableArticle[]> {
    const request = search
      ? this.http.get<SellableArticleDto[]>('/api/sales/articles', { params: new HttpParams().set('search', search) })
      : this.http.get<SellableArticleDto[]>('/api/sales/articles');
    return request.pipe(
      map((articles) => articles.map(mapSellableArticle)),
      catchError((error: unknown) => throwError(() => mapFailure(error))),
    );
  }

  record(command: SaleCommand): Observable<SaleResult> {
    return this.http.post<SaleResultDto>('/api/sales', mapSaleCommand(command)).pipe(
      map(mapSaleResult),
      catchError((error: unknown) => throwError(() => mapFailure(error))),
    );
  }

  getById(operationId: string): Observable<SaleResult> {
    return this.http.get<SaleResultDto>(`/api/sales/${encodeURIComponent(operationId)}`).pipe(
      map(mapSaleResult),
      catchError((error: unknown) => throwError(() => mapFailure(error))),
    );
  }
}
