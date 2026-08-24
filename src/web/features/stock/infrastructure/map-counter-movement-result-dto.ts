import { CounterMovementResult } from '../domain/counter-movement-result';
import { CounterMovementResultDto } from './dto/counter-movement-result.dto';
import { mapCorrectableSourceDto } from './map-correctable-source-dto';

export const mapCounterMovementResultDto = (result: CounterMovementResultDto): CounterMovementResult => ({
  counterMovement: {
    ...result.counterMovement,
    lines: result.counterMovement.lines.map((line) => ({ ...line })),
  },
  source: mapCorrectableSourceDto(result.source),
  positions: result.positions.map((position) => ({ ...position })),
  financialReversal: result.financialReversal
    ? { ...result.financialReversal, taxRate: { ...result.financialReversal.taxRate } }
    : undefined,
});
