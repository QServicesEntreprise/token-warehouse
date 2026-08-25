import type { CorrectableSource } from '../domain/correctable-source';
import type { CorrectableSourceDto } from './dto/correctable-source.dto';
import { mapCounterMovementFinancialDto } from './map-counter-movement-financial-dto';

export const mapCorrectableSourceDto = (source: CorrectableSourceDto): CorrectableSource => ({
  ...source,
  lines: source.lines.map((line) => ({ ...line })),
  financial: source.financial
    ? mapCounterMovementFinancialDto(source.financial)
    : undefined,
});
