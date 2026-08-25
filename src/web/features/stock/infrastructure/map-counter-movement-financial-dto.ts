import type { CounterMovementFinancial } from '../domain/counter-movement-financial';
import type { CounterMovementFinancialDto } from './dto/counter-movement-financial.dto';

export const mapCounterMovementFinancialDto = (
  financial: CounterMovementFinancialDto,
): CounterMovementFinancial => ({ ...financial, taxRate: { ...financial.taxRate } });
