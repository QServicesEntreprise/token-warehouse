import type { HistoryChange } from './history-change';
import type { HistoryFinancial } from './history-financial';
import type { HistoryFinancialReversal } from './history-financial-reversal';
import type { HistoryLine } from './history-line';

interface HistoryEntryBase {
  id: string;
  timestampUtc: string;
  ean13: string;
  articles: readonly string[];
  lines: readonly HistoryLine[];
  correctedByOperationId?: string | undefined;
  correctionOperationId?: string | undefined;
}

interface SupplyHistoryEntry extends HistoryEntryBase {
  type: 'supply';
  quantity?: number | undefined;
  stockEffect?: number | undefined;
  previousPhysicalStock?: number | undefined;
  resultingPhysicalStock?: number | undefined;
}

interface InventoryHistoryEntry extends HistoryEntryBase {
  type: 'inventory';
  previousPhysicalStock?: number | undefined;
  countedQuantity?: number | undefined;
  difference?: number | undefined;
  resultingPhysicalStock?: number | undefined;
}

interface SaleStockHistoryEntry extends HistoryEntryBase {
  type: 'saleStock';
  quantity?: number | undefined;
  stockEffect?: number | undefined;
  previousPhysicalStock?: number | undefined;
  resultingPhysicalStock?: number | undefined;
  financial?: HistoryFinancial | undefined;
}

interface CounterMovementHistoryEntry extends HistoryEntryBase {
  type: 'counterMovement';
  quantity?: number | undefined;
  stockEffect?: number | undefined;
  resultingPhysicalStock?: number | undefined;
  sourceOperationId?: string | undefined;
  sourceOperationType?: string | undefined;
  justification?: string | undefined;
  financialReversal?: HistoryFinancialReversal | undefined;
}

interface CatalogLifecycleHistoryEntry extends HistoryEntryBase {
  type: 'catalogArchive' | 'catalogReactivate';
  previousStatus?: string | undefined;
  nextStatus?: string | undefined;
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
