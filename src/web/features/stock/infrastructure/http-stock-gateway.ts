import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';
import { StockGateway } from '../application/stock-gateway';
import { StockPosition } from '../domain/stock-position';
import { StockPositionDto } from './dto/stock-position.dto';
import { mapStockPositionDto } from './map-stock-position-dto';

@Injectable()
export class HttpStockGateway implements StockGateway {
  private readonly http = inject(HttpClient);

  list(): Observable<readonly StockPosition[]> {
    return this.http.get<StockPositionDto[]>('/api/stock').pipe(
      map((positions) => positions.map(mapStockPositionDto)),
      catchError((error: HttpErrorResponse) => this.readError(error, 'Le Stock ne peut pas être chargé. Réessayez.')),
    );
  }

  getByEan13(ean13: string): Observable<StockPosition> {
    return this.http.get<StockPositionDto>(`/api/stock/${encodeURIComponent(ean13)}`).pipe(
      map(mapStockPositionDto),
      catchError((error: HttpErrorResponse) => this.readError(error, 'Le détail du Stock ne peut pas être chargé.')),
    );
  }

  private readError(error: HttpErrorResponse, fallback: string): Observable<never> {
    const title = typeof error.error === 'object'
      && error.error !== null
      && 'title' in error.error
      && typeof error.error.title === 'string'
      ? error.error.title
      : fallback;
    return throwError(() => new Error(title));
  }
}
