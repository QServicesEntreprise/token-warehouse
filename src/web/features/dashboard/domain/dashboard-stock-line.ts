export interface DashboardStockLine {
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
