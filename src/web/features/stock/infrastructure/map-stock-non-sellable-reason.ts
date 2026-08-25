import type { StockNonSellableReason } from '../domain/stock-non-sellable-reason';
import type { StockPositionDto } from './dto/stock-position.dto';

export const mapStockNonSellableReason = (
  reason: StockPositionDto['reason'],
): StockNonSellableReason | null => {
  switch (reason) {
    case null: return null;
    case 'ARCHIVED': return 'archived';
    case 'DLC_EXPIRED': return 'dlcExpired';
    case 'UNSELLABLE_PACKAGING': return 'unsellablePackaging';
    default: throw new Error(`Raison de non-vendabilité inconnue : ${String(reason satisfies never)}`);
  }
};
