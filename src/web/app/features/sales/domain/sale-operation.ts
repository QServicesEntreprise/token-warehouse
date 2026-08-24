export interface SaleOperation {
  id: string;
  type: 'SALE';
  ean13: string;
  quantity: number;
  occurredAt: string;
}
