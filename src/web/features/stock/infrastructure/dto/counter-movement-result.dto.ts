import { CorrectableSourceDto } from './correctable-source.dto';

export interface CounterMovementResultDto {
  counterMovement: {
    id: string;
    type: 'COUNTER_MOVEMENT';
    timestampUtc: string;
    sourceOperationId: string;
    sourceOperationType: CorrectableSourceDto['type'];
    justification: string;
    lines: {
      lineNumber: number;
      ean13: string;
      sourceEffect: number;
      inverseEffect: number;
    }[];
  };
  source: CorrectableSourceDto;
  positions: {
    ean13: string;
    physicalStock: number;
    sellableStock: number;
    availability: 'AVAILABLE' | 'OUT_OF_STOCK' | 'NOT_SELLABLE';
    reason: 'ARCHIVED' | 'DLC_EXPIRED' | 'UNSELLABLE_PACKAGING' | null;
  }[];
  financialReversal?: {
    sourceOperationId: string;
    context: 'takeaway' | 'onsite' | null;
    unitPriceHtCents: number;
    taxRate: {
      code: string;
      ratio: string;
      numerator: number;
      denominator: number;
    };
    amountHtCents: number;
    vatCents: number;
    amountTtcCents: number;
  };
}
