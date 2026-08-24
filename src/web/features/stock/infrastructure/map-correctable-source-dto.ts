import { CorrectableSource } from '../domain/correctable-source';
import { CorrectableSourceDto } from './dto/correctable-source.dto';

export const mapCorrectableSourceDto = (source: CorrectableSourceDto): CorrectableSource => ({
  ...source,
  lines: source.lines.map((line) => ({ ...line })),
  financial: source.financial
    ? { ...source.financial, taxRate: { ...source.financial.taxRate } }
    : undefined,
});
