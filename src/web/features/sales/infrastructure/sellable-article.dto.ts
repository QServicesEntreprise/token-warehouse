export interface SellableArticleDto {
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
  priceQuotes?: Array<{
    saleContext?: 'takeaway' | 'onsite';
    taxRate: {
      code: string;
      ratio: string;
      numerator: number;
      denominator: number;
    };
    vatCents: number;
    priceTtcCents: number;
  }>;
  dlc?: string;
  consumptionModes?: ('takeaway' | 'onsite')[];
  packaging?: 'new' | 'refurbished' | 'unsellable';
}
