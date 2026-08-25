import type { ConsumptionMode } from '../../../shared-kernel/consumption-mode';

export interface PriceQuote {
  saleContext?: ConsumptionMode;
  taxRate: {
    code: string;
    ratio: string;
    numerator: number;
    denominator: number;
  };
  vatCents: number;
  priceTtcCents: number;
}
