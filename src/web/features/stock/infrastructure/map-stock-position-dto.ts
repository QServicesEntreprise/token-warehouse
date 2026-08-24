import { StockPosition } from '../domain/stock-position';
import { StockPositionDto } from './dto/stock-position.dto';
import { mapStockAvailabilityDto } from './map-stock-availability-dto';
import { mapStockNonSellableReasonDto } from './map-stock-non-sellable-reason-dto';

export const mapStockPositionDto = (dto: StockPositionDto): StockPosition => ({
  ean13: dto.ean13,
  name: dto.name,
  physicalQuantity: dto.physicalQuantity,
  sellableQuantity: dto.sellableQuantity,
  nonSellableQuantity: dto.physicalQuantity - dto.sellableQuantity,
  availability: mapStockAvailabilityDto(dto.availability),
  nonSellableReason: mapStockNonSellableReasonDto(dto.reason),
});
