export interface CounterMovementFinancialDto {
  sourceOperationId?: string;
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
}
