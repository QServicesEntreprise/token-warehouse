import { Observable } from 'rxjs';
import type { SaleCommand } from '../domain/sale-command';
import type { SaleResult } from '../domain/sale-result';
import type { SellableArticle } from '../domain/sellable-article';

export interface SalesGateway {
  searchArticles(search: string): Observable<SellableArticle[]>;
  record(command: SaleCommand): Observable<SaleResult>;
  getById(operationId: string): Observable<SaleResult>;
}
