import { StockPositionDto } from './stock-position.dto';
import { SupplyOperationDto } from './supply-operation.dto';

export interface RecordSupplyResponseDto {
  operation: SupplyOperationDto;
  position: StockPositionDto;
}
