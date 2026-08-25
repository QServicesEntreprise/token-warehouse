import { Observable } from 'rxjs';
import { CorrectableSource } from '../domain/correctable-source';
import { CounterMovementResult } from '../domain/counter-movement-result';
import { InventoryCommand } from '../domain/inventory-command';
import { InventoryReceipt } from '../domain/inventory-receipt';
import { RecordBulkSupplyCommand } from '../domain/record-bulk-supply-command';
import { RecordCounterMovementCommand } from '../domain/record-counter-movement-command';
import { RecordSupplyCommand } from '../domain/record-supply-command';
import { StockPosition } from '../domain/stock-position';
import { SupplyResult } from '../domain/supply-result';

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
}
