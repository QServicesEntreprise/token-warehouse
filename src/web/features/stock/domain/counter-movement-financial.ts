export interface CounterMovementFinancial {
  readonly sourceOperationId?: string;
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
}
