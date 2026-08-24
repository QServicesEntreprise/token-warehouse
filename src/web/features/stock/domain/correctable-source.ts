import { CounterMovementFinancial } from './counter-movement-financial';

export interface CorrectableSource {
  readonly id: string;
  readonly type: 'SUPPLY' | 'INVENTORY' | 'SALE';
  readonly timestampUtc: string;
  readonly ean13: string;
  readonly lines: readonly {
    readonly lineNumber: number;
    readonly ean13: string;
    readonly stockEffect: number;
  }[];
  readonly financial?: CounterMovementFinancial;
}
