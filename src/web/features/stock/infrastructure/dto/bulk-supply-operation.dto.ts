import type { BulkSupplyOperationLineDto } from './bulk-supply-operation-line.dto';

export interface BulkSupplyOperationDto {
  id: string;
  type: 'supply';
  occurredAt: string;
  lines: BulkSupplyOperationLineDto[];
}
