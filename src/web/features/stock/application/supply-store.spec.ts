import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupplyResult } from '../domain/supply-result';
import { STOCK_GATEWAY } from './stock-gateway-token';
import { SupplyStore } from './supply-store';

const result: SupplyResult = {
  operation: {
    id: 'supply-1',
    occurredAt: '2030-01-15T10:00:00Z',
    lines: [{ lineNumber: 1, ean13: '0123456789012', quantity: 3 }],
  },
  positions: [{
    ean13: '0123456789012',
    name: 'Article reçu',
    physicalQuantity: 11,
    sellableQuantity: 11,
    nonSellableQuantity: 0,
    availability: 'available',
    nonSellableReason: null,
  }],
};

describe('SupplyStore', () => {
  const recordSupply = vi.fn();
  const recordBulkSupply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        SupplyStore,
        { provide: STOCK_GATEWAY, useValue: { list: vi.fn(), getByEan13: vi.fn(), recordSupply, recordBulkSupply } },
      ],
    });
  });

  it('sends a unit Approvisionnement once and exposes the committed result', async () => {
    const pending = new Subject<SupplyResult>();
    recordSupply.mockReturnValue(pending);
    const store = TestBed.inject(SupplyStore);
    const command = { ean13: '0123456789012', quantity: 3 };

    const submission = store.recordSupply(command);
    const duplicate = store.recordSupply(command);
    pending.next(result);
    pending.complete();

    await expect(submission).resolves.toBe(true);
    await expect(duplicate).resolves.toBe(false);
    expect(recordSupply).toHaveBeenCalledTimes(1);
    expect(store.result()).toEqual(result);
    expect(store.statusMessage()).toContain('supply-1');
  });

  it('uses the same state for the complete bulk Approvisionnement result', async () => {
    const bulkResult: SupplyResult = {
      operation: {
        id: 'bulk-1',
        occurredAt: '2030-01-15T10:00:00Z',
        lines: [
          { lineNumber: 1, ean13: '0123456789012', quantity: 3 },
          { lineNumber: 2, ean13: '5901234123457', quantity: 2 },
        ],
      },
      positions: [result.positions[0]!, { ...result.positions[0]!, ean13: '5901234123457' }],
    };
    recordBulkSupply.mockReturnValue(of(bulkResult));
    const store = TestBed.inject(SupplyStore);

    await expect(store.recordBulkSupply({ lines: bulkResult.operation.lines })).resolves.toBe(true);

    expect(recordBulkSupply).toHaveBeenCalledTimes(1);
    expect(store.result()).toEqual(bulkResult);
  });

  it('exposes server field errors without dropping the submitted draft', async () => {
    recordSupply.mockReturnValue(throwError(() => ({
      title: 'La quantité est invalide.',
      fieldErrors: { quantity: ['Quantité invalide.'] },
    })));
    const store = TestBed.inject(SupplyStore);

    await expect(store.recordSupply({ ean13: '0123456789012', quantity: 0 })).resolves.toBe(false);

    expect(store.fieldErrors()).toEqual({ quantity: 'Quantité invalide.' });
    expect(store.statusMessage()).toBe('La quantité est invalide.');
  });

  it('ignores a response after its route-scoped store is destroyed', async () => {
    const pending = new Subject<SupplyResult>();
    recordSupply.mockReturnValue(pending);
    const store = TestBed.inject(SupplyStore);
    const submission = store.recordSupply({ ean13: '0123456789012', quantity: 3 });

    TestBed.resetTestingModule();
    pending.next(result);
    pending.complete();

    await expect(submission).resolves.toBe(false);
    expect(store.result()).toBeNull();
  });
});
