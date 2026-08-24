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
  readonly financial?: {
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
