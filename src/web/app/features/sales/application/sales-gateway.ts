import { Observable } from 'rxjs';
import { SaleCommand } from '../domain/sale-command';
import { SaleResult } from '../domain/sale-result';
import { SellableArticle } from '../domain/sellable-article';

export interface SalesGateway {
  searchArticles(search: string): Observable<SellableArticle[]>;
  record(command: SaleCommand): Observable<SaleResult>;
  getById(operationId: string): Observable<SaleResult>;
}
