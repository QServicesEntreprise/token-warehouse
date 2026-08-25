import { Observable } from 'rxjs';
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
import type { HistoryQuery } from './history-query';

export interface StockGateway {
  list(): Observable<readonly StockPosition[]>;
  getByEan13(ean13: string): Observable<StockPosition>;
  recordInventory(command: InventoryCommand): Observable<InventoryReceipt>;
  recordBulkInventory(commands: readonly InventoryCommand[]): Observable<InventoryReceipt>;
  getInventoryById(id: string): Observable<InventoryReceipt>;
  recordSupply(command: RecordSupplyCommand): Observable<SupplyResult>;
  recordBulkSupply(command: RecordBulkSupplyCommand): Observable<SupplyResult>;
  listCorrectableSources(): Observable<readonly CorrectableSource[]>;
  recordCounterMovement(command: RecordCounterMovementCommand): Observable<CounterMovementResult>;
  history(query: HistoryQuery): Observable<readonly HistoryEntry[]>;
}
