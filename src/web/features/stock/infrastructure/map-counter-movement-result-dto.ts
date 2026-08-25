import type { CounterMovementResult } from '../domain/counter-movement-result';
import type { CounterMovementResultDto } from './dto/counter-movement-result.dto';
import { mapCorrectableSourceDto } from './map-correctable-source-dto';
import { mapCounterMovementFinancialDto } from './map-counter-movement-financial-dto';
import { mapStockAvailability } from './map-stock-availability';
import { mapStockNonSellableReason } from './map-stock-non-sellable-reason';

export const mapCounterMovementResultDto = (result: CounterMovementResultDto): CounterMovementResult => ({
  counterMovement: {
    ...result.counterMovement,
    lines: result.counterMovement.lines.map((line) => ({ ...line })),
  },
  source: mapCorrectableSourceDto(result.source),
  positions: result.positions.map((position) => ({
    ean13: position.ean13,
    physicalQuantity: position.physicalStock,
    sellableQuantity: position.sellableStock,
    availability: mapStockAvailability(position.availability),
    nonSellableReason: mapStockNonSellableReason(position.reason),
  })),
  financialReversal: result.financialReversal
    ? {
        ...mapCounterMovementFinancialDto(result.financialReversal),
        sourceOperationId: result.financialReversal.sourceOperationId,
      }
    : undefined,
});
