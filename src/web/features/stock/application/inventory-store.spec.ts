import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryReceipt } from '../domain/inventory-receipt';
import { LAST_INVENTORY_STORAGE } from './last-inventory-storage-token';
import { STOCK_GATEWAY } from './stock-gateway-token';
import { InventoryStore } from './inventory-store';

const receipt = (id: string): InventoryReceipt => ({
  id,
  timestampUtc: '2030-01-15T10:00:00+00:00',
  lines: [{
    lineNumber: 1,
    ean13: '0123456789012',
    previousPhysicalStock: 5,
    countedQuantity: 11,
    inventoryDifference: 6,
    resultingPhysicalStock: 11,
    position: {
      ean13: '0123456789012',
      physicalQuantity: 11,
      sellableQuantity: 11,
      availability: 'available',
      nonSellableReason: null,
    },
  }],
});

describe('InventoryStore', () => {
  const recordInventory = vi.fn();
  const recordBulkInventory = vi.fn();
  const getInventoryById = vi.fn();
  const load = vi.fn();
  const save = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        InventoryStore,
        {
          provide: STOCK_GATEWAY,
          useValue: {
            list: () => of([]),
            getByEan13: () => throwError(() => new Error('Position hors test')),
            recordInventory,
            recordBulkInventory,
            getInventoryById,
          },
        },
        { provide: LAST_INVENTORY_STORAGE, useValue: { load, save } },
      ],
    });
  });

  it('commits one mutation and rejects a double submission', async () => {
    const pending = new Subject<InventoryReceipt>();
    recordInventory.mockReturnValue(pending);
    const store = TestBed.inject(InventoryStore);
    const command = { ean13: '0123456789012', countedQuantity: 11 };

    const first = store.record([command]);
    const duplicate = store.record([command]);
    pending.next(receipt('inventory-1'));
    pending.complete();

    await expect(first).resolves.toBe(true);
    await expect(duplicate).resolves.toBe(false);
    expect(recordInventory).toHaveBeenCalledOnce();
    expect(store.receipt()).toEqual(receipt('inventory-1'));
    expect(save).toHaveBeenCalledWith('inventory-1');
    expect(store.submitting()).toBe(false);
  });

  it('exposes a bulk rejection without any partial receipt', async () => {
    recordBulkInventory.mockReturnValue(throwError(() => ({
      title: 'Le lot est invalide.',
      fieldErrors: { 'lines[1].ean13': ['Cette Référence apparaît une seule fois.'] },
    })));
    const store = TestBed.inject(InventoryStore);

    await expect(store.record([
      { ean13: '0123456789012', countedQuantity: 11 },
      { ean13: '0123456789012', countedQuantity: 2 },
    ])).resolves.toBe(false);

    expect(store.receipt()).toBeNull();
    expect(store.error()).toBe('Le lot est invalide.');
    expect(store.fieldErrors()).toEqual({
      'lines[1].ean13': ['Cette Référence apparaît une seule fois.'],
    });
  });

  it('keeps only the latest restored Inventory without a request counter', () => {
    const obsolete = new Subject<InventoryReceipt>();
    load.mockReturnValueOnce('inventory-old').mockReturnValueOnce('inventory-new');
    getInventoryById.mockReturnValueOnce(obsolete).mockReturnValueOnce(of(receipt('inventory-new')));
    const store = TestBed.inject(InventoryStore);

    store.restore();
    expect(store.restoreState()).toBe('loading');
    store.restore();
    obsolete.next(receipt('inventory-old'));

    expect(store.restoreState()).toBe('ready');
    expect(store.receipt()?.id).toBe('inventory-new');
  });

  it('reports a restore failure without exposing partial receipt data', () => {
    load.mockReturnValue('inventory-missing');
    getInventoryById.mockReturnValue(throwError(() => ({ title: 'Inventaire absent.', fieldErrors: {} })));
    const store = TestBed.inject(InventoryStore);

    store.restore();

    expect(store.restoreState()).toBe('error');
    expect(store.receipt()).toBeNull();
  });

  it('cancels a delayed restore when a newer Inventory commits', async () => {
    const restored = new Subject<InventoryReceipt>();
    load.mockReturnValue('inventory-old');
    getInventoryById.mockReturnValue(restored);
    recordInventory.mockReturnValue(of(receipt('inventory-new')));
    const store = TestBed.inject(InventoryStore);

    store.restore();
    await store.record([{ ean13: '0123456789012', countedQuantity: 11 }]);
    restored.next(receipt('inventory-old'));

    expect(store.receipt()?.id).toBe('inventory-new');
  });
});
