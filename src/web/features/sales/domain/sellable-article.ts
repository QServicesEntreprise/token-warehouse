import type { SaleContext } from './sale-context';
import type { SaleQuote } from './sale-quote';

export interface SellableArticle {
  ean13: string;
  name: string;
  type: 'food' | 'nonFood';
  isActive: boolean;
  status: 'active' | 'archived';
  priceHtCents: number;
  physicalQuantity: number;
  sellableQuantity: number;
  availability: 'AVAILABLE' | 'OUT_OF_STOCK' | 'NOT_SELLABLE';
  reason: 'ARCHIVED' | 'DLC_EXPIRED' | 'UNSELLABLE_PACKAGING' | null;
  priceQuotes: SaleQuote[];
  dlc?: string | undefined;
  consumptionModes?: SaleContext[] | undefined;
  packaging?: 'new' | 'refurbished' | 'unsellable' | undefined;
}
