import { Observable } from 'rxjs';
import { RecordBulkSupplyCommand } from '../domain/record-bulk-supply-command';
import { RecordSupplyCommand } from '../domain/record-supply-command';
import { StockPosition } from '../domain/stock-position';
import { SupplyResult } from '../domain/supply-result';

export interface StockGateway {
  list(): Observable<readonly StockPosition[]>;
  getByEan13(ean13: string): Observable<StockPosition>;
  recordSupply(command: RecordSupplyCommand): Observable<SupplyResult>;
  recordBulkSupply(command: RecordBulkSupplyCommand): Observable<SupplyResult>;
}
