import type { RecordSupplyCommandDto } from './record-supply-command.dto';

export interface RecordBulkSupplyCommandDto {
  lines: RecordSupplyCommandDto[];
}
