import { Observable } from 'rxjs';
import { InventoryCommand } from '../domain/inventory-command';
import { InventoryReceipt } from '../domain/inventory-receipt';
import { StockPosition } from '../domain/stock-position';

export interface StockGateway {
  list(): Observable<readonly StockPosition[]>;
  getByEan13(ean13: string): Observable<StockPosition>;
  recordInventory(command: InventoryCommand): Observable<InventoryReceipt>;
  recordBulkInventory(commands: readonly InventoryCommand[]): Observable<InventoryReceipt>;
  getInventoryById(id: string): Observable<InventoryReceipt>;
}
