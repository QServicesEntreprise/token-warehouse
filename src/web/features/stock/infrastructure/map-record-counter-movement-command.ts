import type { RecordCounterMovementCommand } from '../domain/record-counter-movement-command';
import type { RecordCounterMovementCommandDto } from './dto/record-counter-movement-command.dto';

export const mapRecordCounterMovementCommand = (
  command: RecordCounterMovementCommand,
): RecordCounterMovementCommandDto => ({
  sourceOperationId: command.sourceOperationId,
  justification: command.justification,
});
