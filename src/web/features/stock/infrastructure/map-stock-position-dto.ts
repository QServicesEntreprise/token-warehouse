import { StockPosition } from '../domain/stock-position';
import { StockNonSellableReason } from '../domain/stock-non-sellable-reason';
import { StockPositionDto } from './dto/stock-position.dto';

export const mapStockPositionDto = (dto: StockPositionDto): StockPosition => ({
  ean13: dto.ean13,
  name: dto.name,
  physicalQuantity: dto.physicalQuantity,
  sellableQuantity: dto.sellableQuantity,
  nonSellableQuantity: dto.physicalQuantity - dto.sellableQuantity,
  availability: dto.availability === 'AVAILABLE'
    ? 'available'
    : dto.availability === 'OUT_OF_STOCK'
      ? 'outOfStock'
      : dto.availability === 'NOT_SELLABLE'
        ? 'notSellable'
        : unknownAvailability(dto.availability),
  nonSellableReason: mapNonSellableReason(dto.reason),
});

const unknownAvailability = (availability: never): never => {
  throw new Error(`Disponibilité Stock inconnue : ${String(availability)}`);
};

const mapNonSellableReason = (reason: StockPositionDto['reason']): StockNonSellableReason | null => {
  switch (reason) {
    case null: return null;
    case 'ARCHIVED': return 'archived';
    case 'DLC_EXPIRED': return 'dlcExpired';
    case 'UNSELLABLE_PACKAGING': return 'unsellablePackaging';
    default: return unknownNonSellableReason(reason);
  }
};

const unknownNonSellableReason = (reason: never): never => {
  throw new Error(`Raison de non-vendabilité inconnue : ${String(reason)}`);
};
