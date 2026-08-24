import { Observable } from 'rxjs';
import { StockPosition } from '../domain/stock-position';

export interface StockGateway {
  list(): Observable<readonly StockPosition[]>;
  getByEan13(ean13: string): Observable<StockPosition>;
}
