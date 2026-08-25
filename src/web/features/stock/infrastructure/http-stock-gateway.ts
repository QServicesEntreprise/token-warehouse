import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, forkJoin, map, switchMap, throwError } from 'rxjs';
import type { HistoryQuery } from '../application/history-query';
import type { StockGateway } from '../application/stock-gateway';
import type { CorrectableSource } from '../domain/correctable-source';
import type { CounterMovementResult } from '../domain/counter-movement-result';
import type { HistoryEntry } from '../domain/history-entry';
import type { InventoryCommand } from '../domain/inventory-command';
import type { InventoryReceipt } from '../domain/inventory-receipt';
import type { RecordBulkSupplyCommand } from '../domain/record-bulk-supply-command';
import type { RecordCounterMovementCommand } from '../domain/record-counter-movement-command';
import type { RecordSupplyCommand } from '../domain/record-supply-command';
import type { StockPosition } from '../domain/stock-position';
import type { SupplyResult } from '../domain/supply-result';
import type { CorrectableSourceDto } from './dto/correctable-source.dto';
import type { CounterMovementResultDto } from './dto/counter-movement-result.dto';
import type { InventoryOperationDto } from './dto/inventory-operation.dto';
import type { InventoryReceiptDto } from './dto/inventory-receipt.dto';
import type { HistoryEntryDto } from './dto/history-entry.dto';
import type { RecordBulkSupplyResponseDto } from './dto/record-bulk-supply-response.dto';
import type { RecordSupplyResponseDto } from './dto/record-supply-response.dto';
import type { StockPositionDto } from './dto/stock-position.dto';
import { mapInventoryCommand } from './map-inventory-command';
import { mapInventoryOperationDto } from './map-inventory-operation-dto';
import { mapInventoryReceiptDto } from './map-inventory-receipt-dto';
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

  recordInventory(command: InventoryCommand): Observable<InventoryReceipt> {
    return this.http.post<InventoryReceiptDto>('/api/inventories', mapInventoryCommand(command)).pipe(
      map(mapInventoryReceiptDto),
      catchError((error: unknown) => throwError(() => mapStockFailure(error, 'L’Inventaire n’a pas pu être enregistré.'))),
    );
  }

  recordBulkInventory(commands: readonly InventoryCommand[]): Observable<InventoryReceipt> {
    return this.http.post<InventoryReceiptDto>('/api/inventories/bulk', {
      lines: commands.map(mapInventoryCommand),
    }).pipe(
      map(mapInventoryReceiptDto),
      catchError((error: unknown) => throwError(() => mapStockFailure(error, 'L’Inventaire en masse n’a pas pu être enregistré.'))),
    );
  }

  getInventoryById(id: string): Observable<InventoryReceipt> {
    return this.http.get<InventoryOperationDto>(`/api/inventories/${encodeURIComponent(id)}`).pipe(
      switchMap((operation) => forkJoin(
        (operation.lines ?? [operation]).map((line) => this.getByEan13(line.ean13)),
      ).pipe(map((positions) => mapInventoryOperationDto(operation, positions)))),
      catchError((error: unknown) => throwError(() => mapStockFailure(error, 'Le dernier Inventaire ne peut pas être relu.'))),
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
    const request = query.scope === 'article'
      ? this.http.get<HistoryEntryDto[]>('/api/history', { params: new HttpParams().set('ean13', query.ean13) })
      : this.http.get<HistoryEntryDto[]>('/api/history');
    return request.pipe(
      map((entries) => entries.map(mapHistoryEntryDto)),
      catchError((error: unknown) => throwError(() => mapStockFailure(
        error,
        'L’Historique ne peut pas être chargé. Réessayez.',
      ))),
    );
  }
}
