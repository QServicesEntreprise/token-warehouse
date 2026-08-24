import { ConsumptionMode } from '../../../../shared-kernel/consumption-mode';
import { TaxRateDto } from './tax-rate.dto';

export interface PriceQuoteDto {
  saleContext?: ConsumptionMode;
  taxRate: TaxRateDto;
  vatCents: number;
  priceTtcCents: number;
}
