import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryStore } from '../application/inventory-store';
import { StockPositionStore } from '../application/stock-position-store';
import { LAST_INVENTORY_STORAGE } from '../application/last-inventory-storage-token';
import { STOCK_GATEWAY } from '../application/stock-gateway-token';
import type { InventoryReceipt } from '../domain/inventory-receipt';
import type { StockPosition } from '../domain/stock-position';
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

const position: StockPosition = {
  ean13: '0123456789012',
  name: 'Article aux deux modes',
  physicalQuantity: 5,
  sellableQuantity: 5,
  nonSellableQuantity: 0,
  availability: 'available',
  nonSellableReason: null,
};

describe('InventoryPage', () => {
  const recordInventory = vi.fn();
  const recordBulkInventory = vi.fn();
  const list = vi.fn();

  const configure = (queryParams: Record<string, string> = {}) => TestBed.configureTestingModule({
    imports: [InventoryPage],
    providers: [
      provideRouter([]),
      InventoryStore,
      StockPositionStore,
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } },
      },
      {
        provide: STOCK_GATEWAY,
        useValue: {
          list,
          getByEan13: () => throwError(() => new Error('Position hors test')),
          recordInventory,
          recordBulkInventory,
          getInventoryById: () => throwError(() => new Error('Inventaire hors test')),
        },
      },
      { provide: LAST_INVENTORY_STORAGE, useValue: { load: () => null, save: vi.fn() } },
    ],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    list.mockReturnValue(of([position]));
    configure();
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

  it('recalls the Article name and its known physical stock for a counted line', async () => {
    const fixture = TestBed.createComponent(InventoryPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const ean13 = fixture.nativeElement.querySelector('#inventory-ean13') as HTMLInputElement;
    ean13.value = position.ean13;
    ean13.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const hint = fixture.nativeElement.querySelector('.inventory-line-hint') as HTMLElement;
    expect(hint.textContent).toContain('Article aux deux modes');
    expect(hint.textContent).toContain('Stock physique connu : 5 unités');
    expect(fixture.nativeElement.querySelector('#inventory-articles option').getAttribute('value'))
      .toBe(position.ean13);

    ean13.value = '4006381333931';
    ean13.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.inventory-line-hint')).toBeNull();
    expect(fixture.nativeElement.querySelector('#inventory-error')).toBeNull();
  });

  it('prefills the first line from the ean13 query parameter and leaves the count empty', () => {
    TestBed.resetTestingModule();
    configure({ ean13: position.ean13 });
    const fixture = TestBed.createComponent(InventoryPage);
    fixture.detectChanges();

    expect(fixture.componentInstance.model().lines).toHaveLength(1);
    expect(fixture.componentInstance.model().lines[0]).toMatchObject({
      ean13: position.ean13,
      countedQuantity: '',
    });
    expect((fixture.nativeElement.querySelector('#inventory-countedQuantity') as HTMLInputElement).value)
      .toBe('');
  });

  it('records an Inventory even when the Stock positions cannot be loaded', async () => {
    TestBed.resetTestingModule();
    list.mockReturnValue(throwError(() => new Error('Stock indisponible')));
    configure();
    recordInventory.mockReturnValue(of(receipt));
    const fixture = TestBed.createComponent(InventoryPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const ean13 = fixture.nativeElement.querySelector('#inventory-ean13') as HTMLInputElement;
    const quantity = fixture.nativeElement.querySelector('#inventory-countedQuantity') as HTMLInputElement;
    ean13.value = '0123456789012';
    ean13.dispatchEvent(new Event('input'));
    quantity.value = '11';
    quantity.dispatchEvent(new Event('input'));

    await fixture.componentInstance.onSubmit(new Event('submit'));
    fixture.detectChanges();

    expect(recordInventory).toHaveBeenCalledWith({ ean13: '0123456789012', countedQuantity: 11 });
    expect(fixture.nativeElement.querySelector('#inventory-result')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.inventory-line-hint')).toBeNull();
  });
});
