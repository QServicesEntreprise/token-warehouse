import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';
import { HistoryQuery } from '../application/history-query';
import { StockGateway } from '../application/stock-gateway';
import { CorrectableSource } from '../domain/correctable-source';
import { CounterMovementResult } from '../domain/counter-movement-result';
import { HistoryEntry } from '../domain/history-entry';
import { RecordBulkSupplyCommand } from '../domain/record-bulk-supply-command';
import { RecordCounterMovementCommand } from '../domain/record-counter-movement-command';
import { RecordSupplyCommand } from '../domain/record-supply-command';
import { StockPosition } from '../domain/stock-position';
import { SupplyResult } from '../domain/supply-result';
import { CorrectableSourceDto } from './dto/correctable-source.dto';
import { CounterMovementResultDto } from './dto/counter-movement-result.dto';
import { HistoryEntryDto } from './dto/history-entry.dto';
import { RecordBulkSupplyResponseDto } from './dto/record-bulk-supply-response.dto';
import { RecordSupplyResponseDto } from './dto/record-supply-response.dto';
import { StockPositionDto } from './dto/stock-position.dto';
import { mapCorrectableSourceDto } from './map-correctable-source-dto';
import { mapCounterMovementResultDto } from './map-counter-movement-result-dto';
import { mapRecordBulkSupplyCommand } from './map-record-bulk-supply-command';
import { mapRecordBulkSupplyResponse } from './map-record-bulk-supply-response';
import { mapRecordCounterMovementCommand } from './map-record-counter-movement-command';
import { mapRecordSupplyCommand } from './map-record-supply-command';
import { mapRecordSupplyResponse } from './map-record-supply-response';
import { mapStockFailure } from './map-stock-failure';
import { mapHistoryEntryDto } from './map-history-entry-dto';
import { mapStockPositionDto } from './map-stock-position-dto';

@Injectable()
export class HttpStockGateway implements StockGateway {
  private readonly http = inject(HttpClient);

  list(): Observable<readonly StockPosition[]> {
    return this.http.get<StockPositionDto[]>('/api/stock').pipe(
      map((positions) => positions.map(mapStockPositionDto)),
      catchError((error: unknown) => throwError(() => mapStockFailure(error, 'Le Stock ne peut pas être chargé. Réessayez.'))),
    );
  }

  getByEan13(ean13: string): Observable<StockPosition> {
    return this.http.get<StockPositionDto>(`/api/stock/${encodeURIComponent(ean13)}`).pipe(
      map(mapStockPositionDto),
      catchError((error: unknown) => throwError(() => mapStockFailure(error, 'Le détail du Stock ne peut pas être chargé.'))),
    );
  }

  recordSupply(command: RecordSupplyCommand): Observable<SupplyResult> {
    return this.http.post<RecordSupplyResponseDto>('/api/supplies', mapRecordSupplyCommand(command)).pipe(
      map(mapRecordSupplyResponse),
      catchError((error: unknown) => throwError(() => mapStockFailure(error, 'L’Approvisionnement n’a pas pu être enregistré.'))),
    );
  }

  recordBulkSupply(command: RecordBulkSupplyCommand): Observable<SupplyResult> {
    return this.http.post<RecordBulkSupplyResponseDto>(
      '/api/supplies/bulk',
      mapRecordBulkSupplyCommand(command),
    ).pipe(
      map(mapRecordBulkSupplyResponse),
      catchError((error: unknown) => throwError(() => mapStockFailure(error, 'L’Approvisionnement en masse n’a pas pu être enregistré.'))),
    );
  }

  listCorrectableSources(): Observable<readonly CorrectableSource[]> {
    return this.http.get<CorrectableSourceDto[]>('/api/stock/counter-movements/sources').pipe(
      map((sources) => sources.map(mapCorrectableSourceDto)),
      catchError((error: unknown) => throwError(() => mapStockFailure(
        error,
        'Les Opérations corrigeables ne peuvent pas être chargées.',
      ))),
    );
  }

  recordCounterMovement(command: RecordCounterMovementCommand): Observable<CounterMovementResult> {
    return this.http.post<CounterMovementResultDto>(
      '/api/stock/counter-movements',
      mapRecordCounterMovementCommand(command),
    ).pipe(
      map(mapCounterMovementResultDto),
      catchError((error: unknown) => throwError(() => mapStockFailure(
        error,
        'Le Contre-mouvement n’a pas pu être enregistré.',
      ))),
    );
  }

  history(query: HistoryQuery): Observable<readonly HistoryEntry[]> {
    const params = query.scope === 'article'
      ? new HttpParams().set('ean13', query.ean13)
      : undefined;
    return this.http.get<HistoryEntryDto[]>('/api/history', { params }).pipe(
      map((entries) => entries.map(mapHistoryEntryDto)),
      catchError((error: unknown) => throwError(() => mapStockFailure(
        error,
        'L’Historique ne peut pas être chargé. Réessayez.',
      ))),
    );
  }
}
