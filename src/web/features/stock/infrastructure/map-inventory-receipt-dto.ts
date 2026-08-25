import { InventoryReceipt } from '../domain/inventory-receipt';
import { InventoryReceiptDto } from './dto/inventory-receipt.dto';
import { mapStockAvailability } from './map-stock-availability';
import { mapStockNonSellableReason } from './map-stock-non-sellable-reason';

const mapPosition = (position: NonNullable<InventoryReceiptDto['position']>) => ({
  ean13: position.ean13,
  physicalQuantity: position.physicalStock,
  sellableQuantity: position.sellableStock,
  availability: mapStockAvailability(position.availability),
  nonSellableReason: mapStockNonSellableReason(position.reason),
});

export const mapInventoryReceiptDto = (dto: InventoryReceiptDto): InventoryReceipt => {
  if ('lines' in dto.operation) {
    return {
      id: dto.operation.id,
      timestampUtc: dto.operation.timestampUtc,
      lines: dto.operation.lines.map((line) => ({ ...line, position: mapPosition(line.position) })),
    };
  }
  if (!dto.position) {
    throw new Error('Position Inventaire absente de la réponse serveur.');
  }
  return {
    id: dto.operation.id,
    timestampUtc: dto.operation.timestampUtc,
    lines: [{
      lineNumber: 1,
      ean13: dto.operation.ean13,
      previousPhysicalStock: dto.operation.previousPhysicalStock,
      countedQuantity: dto.operation.countedQuantity,
      inventoryDifference: dto.operation.inventoryDifference,
      resultingPhysicalStock: dto.operation.resultingPhysicalStock,
      position: mapPosition(dto.position),
    }],
  };
};
