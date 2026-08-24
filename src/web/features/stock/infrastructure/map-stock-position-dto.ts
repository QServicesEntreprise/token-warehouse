import { StockPosition } from '../domain/stock-position';
import { StockPositionDto } from './dto/stock-position.dto';

export const mapStockPositionDto = (dto: StockPositionDto): StockPosition => ({
  ean13: dto.ean13,
  name: dto.name,
  physicalQuantity: dto.physicalQuantity,
  sellableQuantity: dto.sellableQuantity,
  blockedQuantity: dto.physicalQuantity - dto.sellableQuantity,
  availability: dto.availability === 'AVAILABLE'
    ? 'available'
    : dto.availability === 'OUT_OF_STOCK'
      ? 'outOfStock'
      : dto.availability === 'NOT_SELLABLE'
        ? 'notSellable'
        : unknownAvailability(dto.availability),
  blockReason: dto.reason === 'ARCHIVED'
    ? 'archived'
    : dto.reason === 'DLC_EXPIRED'
      ? 'dlcExpired'
      : dto.reason === 'UNSELLABLE_PACKAGING'
        ? 'unsellablePackaging'
        : null,
});

const unknownAvailability = (availability: never): never => {
  throw new Error(`Disponibilité Stock inconnue : ${String(availability)}`);
};
