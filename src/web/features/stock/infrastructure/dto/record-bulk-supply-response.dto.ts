import { BulkSupplyOperationDto } from './bulk-supply-operation.dto';
import { StockPositionDto } from './stock-position.dto';

export interface RecordBulkSupplyResponseDto {
  operation: BulkSupplyOperationDto;
  positions: StockPositionDto[];
}
