export interface InventoryOperationDto {
  id: string;
  type: 'INVENTORY';
  ean13: string;
  previousPhysicalStock: number;
  countedQuantity: number;
  inventoryDifference: number;
  resultingPhysicalStock: number;
  timestampUtc: string;
  lines?: {
    lineNumber: number;
    ean13: string;
    previousPhysicalStock: number;
    countedQuantity: number;
    inventoryDifference: number;
    resultingPhysicalStock: number;
  }[];
}
