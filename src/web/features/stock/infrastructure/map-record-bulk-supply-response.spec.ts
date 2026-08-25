import { describe, expect, it } from 'vitest';
import type { RecordBulkSupplyResponseDto } from './dto/record-bulk-supply-response.dto';
import { mapRecordBulkSupplyResponse } from './map-record-bulk-supply-response';

describe('mapRecordBulkSupplyResponse', () => {
  it('keeps every committed line and server position in the submitted order', () => {
    const dto: RecordBulkSupplyResponseDto = {
      operation: {
        id: 'bulk-1',
        type: 'supply',
        occurredAt: '2030-01-15T10:00:00Z',
        lines: [
          { lineNumber: 1, ean13: '0123456789012', quantity: 3 },
          { lineNumber: 2, ean13: '5901234123457', quantity: 2 },
        ],
      },
      positions: [
        {
          ean13: '0123456789012', name: 'Premier', type: 'food', isActive: true, status: 'active',
          physicalQuantity: 11, sellableQuantity: 11, availability: 'AVAILABLE', reason: null,
        },
        {
          ean13: '5901234123457', name: 'Second', type: 'nonFood', isActive: true, status: 'active',
          physicalQuantity: 7, sellableQuantity: 0, availability: 'NOT_SELLABLE', reason: 'UNSELLABLE_PACKAGING',
        },
      ],
    };

    const result = mapRecordBulkSupplyResponse(dto);

    expect(result).toMatchObject({
      operation: {
        id: 'bulk-1',
        lines: [
          { lineNumber: 1, ean13: '0123456789012', quantity: 3 },
          { lineNumber: 2, ean13: '5901234123457', quantity: 2 },
        ],
      },
      positions: [
        { ean13: '0123456789012', physicalQuantity: 11, sellableQuantity: 11 },
        { ean13: '5901234123457', physicalQuantity: 7, sellableQuantity: 0 },
      ],
    });
    expect(result.operation.lines[0]).not.toBe(dto.operation.lines[0]);
  });
});
