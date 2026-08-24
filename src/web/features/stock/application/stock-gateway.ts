import { Observable } from 'rxjs';
import { CorrectableSource } from '../domain/correctable-source';
import { CounterMovementResult } from '../domain/counter-movement-result';
import { HistoryEntry } from '../domain/history-entry';
import { RecordBulkSupplyCommand } from '../domain/record-bulk-supply-command';
import { RecordCounterMovementCommand } from '../domain/record-counter-movement-command';
import { RecordSupplyCommand } from '../domain/record-supply-command';
import { StockPosition } from '../domain/stock-position';
import { SupplyResult } from '../domain/supply-result';
import { HistoryQuery } from './history-query';

export interface StockGateway {
  list(): Observable<readonly StockPosition[]>;
  getByEan13(ean13: string): Observable<StockPosition>;
  recordSupply(command: RecordSupplyCommand): Observable<SupplyResult>;
  recordBulkSupply(command: RecordBulkSupplyCommand): Observable<SupplyResult>;
  listCorrectableSources(): Observable<readonly CorrectableSource[]>;
  recordCounterMovement(command: RecordCounterMovementCommand): Observable<CounterMovementResult>;
  history(query: HistoryQuery): Observable<readonly HistoryEntry[]>;
}
