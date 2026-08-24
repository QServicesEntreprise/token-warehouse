export interface SaleResultDto {
  operation: {
    id: string;
    type: 'SALE';
    ean13: string;
    quantity: number;
    occurredAt: string;
  };
  financial: {
    context: 'takeaway' | 'onsite' | null;
    unitPriceHtCents: number;
    taxRate: {
      code: string;
      ratio: string;
      numerator: number;
      denominator: number;
    };
    amountHtCents: number;
    vatCents: number;
    amountTtcCents: number;
  };
  position: {
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
    consumptionModes?: ('takeaway' | 'onsite')[];
    packaging?: 'new' | 'refurbished' | 'unsellable';
  };
}
