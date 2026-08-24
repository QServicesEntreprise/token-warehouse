import { HistoryEntry } from '../domain/history-entry';
import { HistoryFinancial } from '../domain/history-financial';
import { HistoryLine } from '../domain/history-line';
import { HistoryEntryDto } from './dto/history-entry.dto';

export const mapHistoryEntryDto = (dto: HistoryEntryDto): HistoryEntry => {
  const base = {
    id: dto.id,
    timestampUtc: dto.timestampUtc,
    ean13: dto.ean13,
    articles: dto.articles.map(({ ean13 }) => ean13),
    lines: dto.lines.map(mapHistoryLine),
    correctedByOperationId: dto.correctedByOperationId,
    correctionOperationId: dto.correctionOperationId,
  };

  switch (dto.type) {
    case 'SUPPLY': return {
      ...base,
      type: 'supply',
      quantity: dto.quantity,
      stockEffect: dto.stockEffect,
      previousPhysicalStock: dto.previousPhysicalStock,
      resultingPhysicalStock: dto.resultingPhysicalStock,
    };
    case 'INVENTORY': return {
      ...base,
      type: 'inventory',
      previousPhysicalStock: dto.previousPhysicalStock,
      countedQuantity: dto.countedQuantity,
      difference: dto.difference,
      resultingPhysicalStock: dto.resultingPhysicalStock,
    };
    case 'SALE_STOCK': return {
      ...base,
      type: 'saleStock',
      quantity: dto.quantity,
      stockEffect: dto.stockEffect,
      previousPhysicalStock: dto.previousPhysicalStock,
      resultingPhysicalStock: dto.resultingPhysicalStock,
      financial: dto.financial ? mapFinancial(dto.financial) : undefined,
    };
    case 'COUNTER_MOVEMENT': return {
      ...base,
      type: 'counterMovement',
      quantity: dto.quantity,
      stockEffect: dto.stockEffect,
      resultingPhysicalStock: dto.resultingPhysicalStock,
      sourceOperationId: dto.sourceOperationId,
      sourceOperationType: dto.sourceOperationType,
      justification: dto.justification,
      financialReversal: dto.financialReversal ? {
        ...mapFinancial(dto.financialReversal),
        sourceOperationId: dto.financialReversal.sourceOperationId,
      } : undefined,
    };
    case 'CATALOG_ARCHIVE': return {
      ...base,
      type: 'catalogArchive',
      previousStatus: dto.previousStatus,
      nextStatus: dto.nextStatus,
    };
    case 'CATALOG_REACTIVATE': return {
      ...base,
      type: 'catalogReactivate',
      previousStatus: dto.previousStatus,
      nextStatus: dto.nextStatus,
    };
    case 'CATALOG_DLC_CHANGE': return {
      ...base,
      type: 'catalogDlcChange',
      changes: mapChanges(dto),
    };
    case 'CATALOG_PACKAGING_CHANGE': return {
      ...base,
      type: 'catalogPackagingChange',
      changes: mapChanges(dto),
    };
    case 'CATALOG_ATTRIBUTE_CHANGE': return {
      ...base,
      type: 'catalogAttributeChange',
      changes: mapChanges(dto),
    };
    default: return { ...base, type: 'unknown', sourceType: dto.type };
  }
};

const mapHistoryLine = (line: HistoryEntryDto['lines'][number]): HistoryLine => ({
  lineNumber: line.lineNumber,
  ean13: line.ean13,
  quantity: line.quantity,
  previousPhysicalStock: line.previousPhysicalStock,
  countedQuantity: line.countedQuantity,
  difference: line.difference,
  stockEffect: line.stockEffect,
  inverseEffect: line.inverseEffect,
  resultingPhysicalStock: line.resultingPhysicalStock,
});

const mapFinancial = (financial: NonNullable<HistoryEntryDto['financial']>): HistoryFinancial => ({
  context: financial.context,
  unitPriceHtCents: financial.unitPriceHtCents,
  taxRate: {
    code: financial.taxRate.code,
    ratio: financial.taxRate.ratio,
    numerator: financial.taxRate.numerator,
    denominator: financial.taxRate.denominator,
  },
  amountHtCents: financial.amountHtCents,
  vatCents: financial.vatCents,
  amountTtcCents: financial.amountTtcCents,
});

const mapChanges = (dto: HistoryEntryDto) => (dto.changes ?? []).map((change) => ({
  field: change.field,
  before: change.before ?? change.previousValue,
  after: change.after ?? change.nextValue,
}));
