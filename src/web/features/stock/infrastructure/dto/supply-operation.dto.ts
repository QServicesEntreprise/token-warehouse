export interface SupplyOperationDto {
  id: string;
  type: 'supply';
  ean13: string;
  quantity: number;
  occurredAt: string;
}
