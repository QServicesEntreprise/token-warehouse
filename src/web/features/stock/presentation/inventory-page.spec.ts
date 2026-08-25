import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryStore } from '../application/inventory-store';
import { LAST_INVENTORY_STORAGE } from '../application/last-inventory-storage-token';
import { STOCK_GATEWAY } from '../application/stock-gateway-token';
import type { InventoryReceipt } from '../domain/inventory-receipt';
import { InventoryPage } from './inventory-page';

const receipt: InventoryReceipt = {
  id: 'inventory-1',
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
};

describe('InventoryPage', () => {
  const recordInventory = vi.fn();
  const recordBulkInventory = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [InventoryPage],
      providers: [
        InventoryStore,
        {
          provide: STOCK_GATEWAY,
          useValue: {
            list: () => of([]),
            getByEan13: () => throwError(() => new Error('Position hors test')),
            recordInventory,
            recordBulkInventory,
            getInventoryById: () => throwError(() => new Error('Inventaire hors test')),
          },
        },
        { provide: LAST_INVENTORY_STORAGE, useValue: { load: () => null, save: vi.fn() } },
      ],
    });
  });

  it('submits the Signal Form and displays the exact server reconciliation', async () => {
    recordInventory.mockReturnValue(of(receipt));
    const fixture = TestBed.createComponent(InventoryPage);
    fixture.detectChanges();
    const ean13 = fixture.nativeElement.querySelector('#inventory-ean13') as HTMLInputElement;
    const quantity = fixture.nativeElement.querySelector('#inventory-countedQuantity') as HTMLInputElement;
    ean13.value = '0123456789012';
    ean13.dispatchEvent(new Event('input'));
    quantity.value = '11';
    quantity.dispatchEvent(new Event('input'));

    await fixture.componentInstance.onSubmit(new Event('submit'));
    fixture.detectChanges();

    expect(recordInventory).toHaveBeenCalledWith({ ean13: '0123456789012', countedQuantity: 11 });
    const result = fixture.nativeElement.querySelector('#inventory-result') as HTMLElement;
    expect(result.textContent).toContain('Stock physique précédent5 unités');
    expect(result.textContent).toContain('Écart d’inventaire+6');
    expect(result.textContent).toContain('Stock vendable11 unités');
  });

  it('keeps the draft and focuses a rejected server field', async () => {
    recordInventory.mockReturnValue(throwError(() => ({
      title: 'Article introuvable.',
      fieldErrors: { countedQuantity: ['Quantité refusée.'] },
    })));
    const fixture = TestBed.createComponent(InventoryPage);
    fixture.detectChanges();
    const ean13 = fixture.nativeElement.querySelector('#inventory-ean13') as HTMLInputElement;
    const quantity = fixture.nativeElement.querySelector('#inventory-countedQuantity') as HTMLInputElement;
    ean13.value = '0123456789012';
    ean13.dispatchEvent(new Event('input'));
    quantity.value = '5';
    quantity.dispatchEvent(new Event('input'));

    await fixture.componentInstance.onSubmit(new Event('submit'));
    fixture.detectChanges();

    expect(fixture.componentInstance.model().lines[0]!.countedQuantity).toBe('5');
    expect(fixture.nativeElement.querySelector('#inventory-countedQuantity')).toBe(document.activeElement);
    expect(fixture.nativeElement.querySelector('#inventory-error').textContent).toContain('introuvable');
    expect(fixture.nativeElement.querySelector('#inventory-result')).toBeNull();
  });
});
