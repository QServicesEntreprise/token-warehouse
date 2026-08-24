import { ConsumptionMode } from '../shared-kernel/consumption-mode';

export interface SalePriceQuote {
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
