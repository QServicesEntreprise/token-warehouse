import { InventoryReceipt } from '../domain/inventory-receipt';
import { StockPosition } from '../domain/stock-position';
import { InventoryOperationDto } from './dto/inventory-operation.dto';

export const mapInventoryOperationDto = (
  operation: InventoryOperationDto,
  positions: readonly StockPosition[],
): InventoryReceipt => ({
  id: operation.id,
  timestampUtc: operation.timestampUtc,
  lines: (operation.lines ?? [{ ...operation, lineNumber: 1 }]).map((line) => {
    const position = positions.find((candidate) => candidate.ean13 === line.ean13);
    if (!position) {
      throw new Error(`Position Stock absente pour l’Inventaire ${line.ean13}.`);
    }
    return {
      ...line,
      position: {
        ean13: position.ean13,
        physicalQuantity: position.physicalQuantity,
        sellableQuantity: position.sellableQuantity,
        availability: position.availability,
        nonSellableReason: position.nonSellableReason,
      },
    };
  }),
});
