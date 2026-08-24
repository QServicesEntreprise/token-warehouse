import { CorrectableSource } from './correctable-source';

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
    readonly physicalStock: number;
    readonly sellableStock: number;
    readonly availability: 'AVAILABLE' | 'OUT_OF_STOCK' | 'NOT_SELLABLE';
    readonly reason: 'ARCHIVED' | 'DLC_EXPIRED' | 'UNSELLABLE_PACKAGING' | null;
  }[];
  readonly financialReversal?: {
    readonly sourceOperationId: string;
    readonly context: 'takeaway' | 'onsite' | null;
    readonly unitPriceHtCents: number;
    readonly taxRate: {
      readonly code: string;
      readonly ratio: string;
      readonly numerator: number;
      readonly denominator: number;
    };
    readonly amountHtCents: number;
    readonly vatCents: number;
    readonly amountTtcCents: number;
  };
}
