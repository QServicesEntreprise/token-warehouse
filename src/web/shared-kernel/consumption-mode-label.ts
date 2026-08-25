import type { ConsumptionMode } from './consumption-mode';

export const consumptionModeLabel = (mode: ConsumptionMode): string =>
  mode === 'takeaway' ? 'À emporter' : 'Sur place';
