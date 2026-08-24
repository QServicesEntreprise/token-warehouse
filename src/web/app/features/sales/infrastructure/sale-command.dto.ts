export interface SaleCommandDto {
  ean13: string;
  quantity: number;
  context?: 'takeaway' | 'onsite';
}
