import { HistoryChange } from './history-change';
import { HistoryFinancial } from './history-financial';
import { HistoryFinancialReversal } from './history-financial-reversal';
import { HistoryLine } from './history-line';

interface HistoryEntryBase {
  id: string;
  timestampUtc: string;
  ean13: string;
  articles: readonly string[];
  lines: readonly HistoryLine[];
  correctedByOperationId?: string;
  correctionOperationId?: string;
}

interface SupplyHistoryEntry extends HistoryEntryBase {
  type: 'supply';
  quantity?: number;
  stockEffect?: number;
  previousPhysicalStock?: number;
  resultingPhysicalStock?: number;
}

interface InventoryHistoryEntry extends HistoryEntryBase {
  type: 'inventory';
  previousPhysicalStock?: number;
  countedQuantity?: number;
  difference?: number;
  resultingPhysicalStock?: number;
}

interface SaleStockHistoryEntry extends HistoryEntryBase {
  type: 'saleStock';
  quantity?: number;
  stockEffect?: number;
  previousPhysicalStock?: number;
  resultingPhysicalStock?: number;
  financial?: HistoryFinancial;
}

interface CounterMovementHistoryEntry extends HistoryEntryBase {
  type: 'counterMovement';
  quantity?: number;
  stockEffect?: number;
  resultingPhysicalStock?: number;
  sourceOperationId?: string;
  sourceOperationType?: string;
  justification?: string;
  financialReversal?: HistoryFinancialReversal;
}

interface CatalogLifecycleHistoryEntry extends HistoryEntryBase {
  type: 'catalogArchive' | 'catalogReactivate';
  previousStatus?: string;
  nextStatus?: string;
}

interface CatalogChangeHistoryEntry extends HistoryEntryBase {
  type: 'catalogDlcChange' | 'catalogPackagingChange' | 'catalogAttributeChange';
  changes: readonly HistoryChange[];
}

interface UnknownHistoryEntry extends HistoryEntryBase {
  type: 'unknown';
  sourceType: string;
}

export type HistoryEntry =
  | SupplyHistoryEntry
  | InventoryHistoryEntry
  | SaleStockHistoryEntry
  | CounterMovementHistoryEntry
  | CatalogLifecycleHistoryEntry
  | CatalogChangeHistoryEntry
  | UnknownHistoryEntry;
