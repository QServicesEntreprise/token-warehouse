import { SupplyResult } from '../domain/supply-result';
import { RecordBulkSupplyResponseDto } from './dto/record-bulk-supply-response.dto';
import { mapStockPositionDto } from './map-stock-position-dto';

export const mapRecordBulkSupplyResponse = (dto: RecordBulkSupplyResponseDto): SupplyResult => ({
  operation: {
    id: dto.operation.id,
    occurredAt: dto.operation.occurredAt,
    lines: dto.operation.lines,
  },
  positions: dto.positions.map(mapStockPositionDto),
});
