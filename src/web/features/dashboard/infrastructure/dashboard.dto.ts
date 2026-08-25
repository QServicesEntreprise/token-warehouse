interface DashboardStockLineDto {
  ean13: string;
  name: string;
  articleType: 'food' | 'nonFood';
  lifecycleStatus: 'ACTIVE' | 'ARCHIVED';
  physicalStock: number;
  sellableStock: number;
  nonSellableStock: number;
  availability: 'AVAILABLE' | 'OUT_OF_STOCK' | 'NOT_SELLABLE';
  reason: 'ARCHIVED' | 'DLC_EXPIRED' | 'UNSELLABLE_PACKAGING' | null;
}

export interface DashboardDto {
  kpis: {
    physicalStock: number;
    sellableStock: number;
    nonSellableStock: number;
  };
  alerts: {
    outOfStock: DashboardStockLineDto[];
    notSellable: DashboardStockLineDto[];
  };
  stockByArticle: DashboardStockLineDto[];
  financial?: {
    revenueHtCents: number;
    revenueTtcCents: number;
    vatCollectedCents: number;
    byTaxRate: Array<{
      taxRate: {
        code: 'takeaway' | 'onsite' | 'nonFood';
        ratio: string;
        numerator: number;
        denominator: number;
      };
      amountHtCents: number;
      vatCents: number;
      amountTtcCents: number;
    }>;
  } | null;
}
