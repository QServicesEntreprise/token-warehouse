import { StockPosition } from '../domain/stock-position';
import { StockPositionDto } from './dto/stock-position.dto';
import { mapStockAvailability } from './map-stock-availability';
import { mapStockNonSellableReason } from './map-stock-non-sellable-reason';

export const mapStockPositionDto = (dto: StockPositionDto): StockPosition => ({
  ean13: dto.ean13,
  name: dto.name,
  physicalQuantity: dto.physicalQuantity,
  sellableQuantity: dto.sellableQuantity,
  nonSellableQuantity: dto.physicalQuantity - dto.sellableQuantity,
  availability: mapStockAvailability(dto.availability),
  nonSellableReason: mapStockNonSellableReason(dto.reason),
});
