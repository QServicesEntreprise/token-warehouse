import { SaleContext } from './sale-context';

export interface SalePosition {
  ean13: string;
  name: string;
  type: 'food' | 'nonFood';
  isActive: boolean;
  status: 'active' | 'archived';
  physicalQuantity: number;
  sellableQuantity: number;
  availability: 'AVAILABLE' | 'OUT_OF_STOCK' | 'NOT_SELLABLE';
  reason: 'ARCHIVED' | 'DLC_EXPIRED' | 'UNSELLABLE_PACKAGING' | null;
  dlc?: string;
  consumptionModes?: SaleContext[];
  packaging?: 'new' | 'refurbished' | 'unsellable';
}
