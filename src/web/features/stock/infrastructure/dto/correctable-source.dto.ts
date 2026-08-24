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
  financial?: {
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
