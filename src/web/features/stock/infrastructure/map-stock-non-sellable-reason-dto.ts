import { StockNonSellableReason } from '../domain/stock-non-sellable-reason';

export const mapStockNonSellableReasonDto = (
  reason: 'ARCHIVED' | 'DLC_EXPIRED' | 'UNSELLABLE_PACKAGING' | null,
): StockNonSellableReason | null => {
  switch (reason) {
    case null: return null;
    case 'ARCHIVED': return 'archived';
    case 'DLC_EXPIRED': return 'dlcExpired';
    case 'UNSELLABLE_PACKAGING': return 'unsellablePackaging';
    default: return unknownReason(reason);
  }
};

const unknownReason = (reason: never): never => {
  throw new Error(`Raison de non-vendabilité inconnue : ${String(reason)}`);
};
