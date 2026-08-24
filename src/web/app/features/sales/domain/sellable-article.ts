import { SaleContext } from './sale-context';
import { SaleQuote } from './sale-quote';

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
  dlc?: string;
  consumptionModes?: SaleContext[];
  packaging?: 'new' | 'refurbished' | 'unsellable';
}
