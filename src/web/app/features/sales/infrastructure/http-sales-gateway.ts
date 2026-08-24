import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { catchError, map, Observable, throwError } from 'rxjs';
import { SaleFailure } from '../application/sale-failure';
import { SalesGateway } from '../application/sales-gateway';
import { SaleCommand } from '../domain/sale-command';
import { SaleResult } from '../domain/sale-result';
import { SellableArticle } from '../domain/sellable-article';
import { mapSaleCommand } from './map-sale-command';
import { mapSaleResult } from './map-sale-result';
import { mapSellableArticle } from './map-sellable-article';
import { SaleResultDto } from './sale-result.dto';
import { SellableArticleDto } from './sellable-article.dto';

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
    const params = search ? new HttpParams().set('search', search) : undefined;
    return this.http.get<SellableArticleDto[]>('/api/sales/articles', { params }).pipe(
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
