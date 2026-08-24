import { ConsumptionMode } from '../../../../shared-kernel/consumption-mode';
import { ArticleStatus } from '../../domain/article-status';
import { ArticleType } from '../../domain/article-type';
import { Packaging } from '../../domain/packaging';
import { ArticleStockDto } from './article-stock.dto';
import { PriceQuoteDto } from './price-quote.dto';

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
