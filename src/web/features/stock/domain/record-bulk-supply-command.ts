import type { RecordSupplyCommand } from './record-supply-command';

export interface RecordBulkSupplyCommand {
  lines: readonly RecordSupplyCommand[];
}
