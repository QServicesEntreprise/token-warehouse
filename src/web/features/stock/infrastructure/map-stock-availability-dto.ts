import { StockAvailability } from '../domain/stock-availability';

export const mapStockAvailabilityDto = (
  availability: 'AVAILABLE' | 'OUT_OF_STOCK' | 'NOT_SELLABLE',
): StockAvailability => {
  switch (availability) {
    case 'AVAILABLE': return 'available';
    case 'OUT_OF_STOCK': return 'outOfStock';
    case 'NOT_SELLABLE': return 'notSellable';
    default: return unknownAvailability(availability);
  }
};

const unknownAvailability = (availability: never): never => {
  throw new Error(`Disponibilité Stock inconnue : ${String(availability)}`);
};
