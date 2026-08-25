import type { ConsumptionMode } from '../../../../shared-kernel/consumption-mode';
import type { ArticleStatus } from '../../domain/article-status';
import type { ArticleType } from '../../domain/article-type';
import type { Packaging } from '../../domain/packaging';
import type { ArticleStockDto } from './article-stock.dto';
import type { PriceQuoteDto } from './price-quote.dto';

export interface ArticleDto {
  ean13: string;
  type: ArticleType;
  name: string;
  priceHtCents: number;
  dlc?: string;
  consumptionModes?: ConsumptionMode[];
  packaging?: Packaging;
  isActive: boolean;
  status: ArticleStatus;
  priceQuotes?: PriceQuoteDto[];
  stock?: ArticleStockDto;
}
