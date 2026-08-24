import { RecordBulkSupplyCommand } from '../domain/record-bulk-supply-command';
import { RecordBulkSupplyCommandDto } from './dto/record-bulk-supply-command.dto';
import { mapRecordSupplyCommand } from './map-record-supply-command';

export const mapRecordBulkSupplyCommand = (command: RecordBulkSupplyCommand): RecordBulkSupplyCommandDto => ({
  lines: command.lines.map(mapRecordSupplyCommand),
});
