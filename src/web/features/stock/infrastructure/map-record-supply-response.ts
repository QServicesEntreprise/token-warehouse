import { SupplyResult } from '../domain/supply-result';
import { RecordSupplyResponseDto } from './dto/record-supply-response.dto';
import { mapStockPositionDto } from './map-stock-position-dto';

export const mapRecordSupplyResponse = (dto: RecordSupplyResponseDto): SupplyResult => ({
  operation: {
    id: dto.operation.id,
    occurredAt: dto.operation.occurredAt,
    lines: [{
      lineNumber: 1,
      ean13: dto.operation.ean13,
      quantity: dto.operation.quantity,
    }],
  },
  positions: [mapStockPositionDto(dto.position)],
});
