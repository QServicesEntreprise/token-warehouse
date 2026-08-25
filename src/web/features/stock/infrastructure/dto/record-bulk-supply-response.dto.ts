import type { BulkSupplyOperationDto } from './bulk-supply-operation.dto';
import type { StockPositionDto } from './stock-position.dto';

export interface RecordBulkSupplyResponseDto {
  operation: BulkSupplyOperationDto;
  positions: StockPositionDto[];
}
