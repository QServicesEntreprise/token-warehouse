import { ConsumptionMode } from '../../../shared-kernel/consumption-mode';
import { ArticleStatus } from './article-status';
import { ArticleStock } from './article-stock';
import { Packaging } from './packaging';
import { PriceQuote } from './price-quote';

interface ArticleBase {
  ean13: string;
  name: string;
  priceHtCents: number;
  status: ArticleStatus;
  priceQuotes: PriceQuote[];
  stock?: ArticleStock;
}

export type Article = ArticleBase & (
  | { type: 'food'; dlc: string; consumptionModes: ConsumptionMode[]; packaging?: never }
  | { type: 'nonFood'; packaging: Packaging; dlc?: never; consumptionModes?: never }
);
