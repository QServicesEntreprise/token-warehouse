import { ConsumptionMode } from '../../../shared-kernel/consumption-mode';
import { ArticleStatus } from './article-status';
import { ArticleStock } from './article-stock';
import { ArticleType } from './article-type';
import { Packaging } from './packaging';
import { PriceQuote } from './price-quote';

export interface Article {
  ean13: string;
  type: ArticleType;
  name: string;
  priceHtCents: number;
  dlc?: string;
  consumptionModes?: ConsumptionMode[];
  packaging?: Packaging;
  isActive: boolean;
  status: ArticleStatus;
  priceQuotes: PriceQuote[];
  stock?: ArticleStock;
}
