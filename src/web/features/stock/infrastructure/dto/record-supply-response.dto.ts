import type { StockPositionDto } from './stock-position.dto';
import type { SupplyOperationDto } from './supply-operation.dto';

export interface RecordSupplyResponseDto {
  operation: SupplyOperationDto;
  position: StockPositionDto;
}
