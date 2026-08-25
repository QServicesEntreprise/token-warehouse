import { CounterMovementFinancialDto } from './counter-movement-financial.dto';

export interface CorrectableSourceDto {
  id: string;
  type: 'SUPPLY' | 'INVENTORY' | 'SALE';
  timestampUtc: string;
  ean13: string;
  lines: {
    lineNumber: number;
    ean13: string;
    stockEffect: number;
  }[];
  financial?: CounterMovementFinancialDto;
}
