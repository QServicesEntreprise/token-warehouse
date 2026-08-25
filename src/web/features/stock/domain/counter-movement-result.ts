import type { CorrectableSource } from './correctable-source';
import type { CounterMovementFinancial } from './counter-movement-financial';
import type { StockAvailability } from './stock-availability';
import type { StockNonSellableReason } from './stock-non-sellable-reason';

export interface CounterMovementResult {
  readonly counterMovement: {
    readonly id: string;
    readonly type: 'COUNTER_MOVEMENT';
    readonly timestampUtc: string;
    readonly sourceOperationId: string;
    readonly sourceOperationType: CorrectableSource['type'];
    readonly justification: string;
    readonly lines: readonly {
      readonly lineNumber: number;
      readonly ean13: string;
      readonly sourceEffect: number;
      readonly inverseEffect: number;
    }[];
  };
  readonly source: CorrectableSource;
  readonly positions: readonly {
    readonly ean13: string;
    readonly physicalQuantity: number;
    readonly sellableQuantity: number;
    readonly availability: StockAvailability;
    readonly nonSellableReason: StockNonSellableReason | null;
  }[];
  readonly financialReversal?: (CounterMovementFinancial & { readonly sourceOperationId: string }) | undefined;
}
