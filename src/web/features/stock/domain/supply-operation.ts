import type { SupplyOperationLine } from './supply-operation-line';

export interface SupplyOperation {
  id: string;
  occurredAt: string;
  lines: readonly SupplyOperationLine[];
}
