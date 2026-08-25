import type { ConsumptionMode } from '../../../shared-kernel/consumption-mode';
import type { ArticleStatus } from './article-status';
import type { ArticleStock } from './article-stock';
import type { Packaging } from './packaging';
import type { PriceQuote } from './price-quote';

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
