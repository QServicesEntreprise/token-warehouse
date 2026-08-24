import { RecordSupplyCommand } from '../domain/record-supply-command';
import { RecordSupplyCommandDto } from './dto/record-supply-command.dto';

export const mapRecordSupplyCommand = (command: RecordSupplyCommand): RecordSupplyCommandDto => ({
  ean13: command.ean13,
  quantity: command.quantity,
});
