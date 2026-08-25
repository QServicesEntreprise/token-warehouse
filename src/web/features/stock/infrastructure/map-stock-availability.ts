import type { StockAvailability } from '../domain/stock-availability';
import type { StockPositionDto } from './dto/stock-position.dto';

export const mapStockAvailability = (availability: StockPositionDto['availability']): StockAvailability => {
  switch (availability) {
    case 'AVAILABLE': return 'available';
    case 'OUT_OF_STOCK': return 'outOfStock';
    case 'NOT_SELLABLE': return 'notSellable';
    default: throw new Error(`Disponibilité Stock inconnue : ${String(availability satisfies never)}`);
  }
};
