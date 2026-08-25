import type { ConsumptionMode } from '../../../../shared-kernel/consumption-mode';
import type { TaxRateDto } from './tax-rate.dto';

export interface PriceQuoteDto {
  saleContext?: ConsumptionMode;
  taxRate: TaxRateDto;
  vatCents: number;
  priceTtcCents: number;
}
