import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { STOCK_GATEWAY } from '../application/stock-gateway-token';
import type { StockGateway } from '../application/stock-gateway';
import { StockPositionStore } from '../application/stock-position-store';
import type { CorrectableSource } from '../domain/correctable-source';
import type { CounterMovementResult } from '../domain/counter-movement-result';
import type { RecordCounterMovementCommand } from '../domain/record-counter-movement-command';
import type { StockPosition } from '../domain/stock-position';
import type { InventoryReceipt } from '../domain/inventory-receipt';
import type { HistoryEntry } from '../domain/history-entry';
import type { HistoryQuery } from '../application/history-query';
import { StockPage } from './stock-page';

const blockedPosition: StockPosition = {
  ean13: '0123456789012',
  name: 'Article bloqué',
  physicalQuantity: 7,
  sellableQuantity: 0,
  nonSellableQuantity: 7,
  availability: 'notSellable',
  nonSellableReason: 'dlcExpired',
};

class FakeStockGateway implements StockGateway {
  list(): Observable<readonly StockPosition[]> {
    return of([blockedPosition]);
  }

  getByEan13(): Observable<StockPosition> {
    return of(blockedPosition);
  }

  recordInventory(): Observable<InventoryReceipt> {
    return throwError(() => new Error('Inventaire hors test'));
  }

  recordBulkInventory(): Observable<InventoryReceipt> {
    return throwError(() => new Error('Inventaire hors test'));
  }

  getInventoryById(): Observable<InventoryReceipt> {
    return throwError(() => new Error('Inventaire hors test'));
  }

  recordSupply(): Observable<never> {
    return throwError(() => new Error('Approvisionnement inattendu'));
  }

  recordBulkSupply(): Observable<never> {
    return throwError(() => new Error('Approvisionnement inattendu'));
  }

  listCorrectableSources(): Observable<readonly CorrectableSource[]> {
    return of([]);
  }

  recordCounterMovement(_command: RecordCounterMovementCommand): Observable<CounterMovementResult> {
    return throwError(() => new Error('Correction absente'));
  }
  history(_query: HistoryQuery): Observable<readonly HistoryEntry[]> {
    return of([]);
  }
}

describe('StockPage', () => {
  it('renders positions and opens an accessible detail', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [StockPage],
      providers: [
        provideRouter([]),
        StockPositionStore,
        { provide: STOCK_GATEWAY, useClass: FakeStockGateway },
      ],
    }).createComponent(StockPage);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const stockPanel = fixture.nativeElement.querySelector('#stock-panel') as HTMLElement;
    expect(stockPanel.querySelector('#stock-state')?.textContent).toContain('1 Article trouvé');
    expect(stockPanel.querySelector('#stock-table')?.textContent).toContain('DLC dépassée');
    expect(stockPanel.querySelector('#stock-table')?.textContent).toContain('Stock non vendable');

    const [detailAction, inventoryAction] = [...stockPanel.querySelectorAll('.table-action')] as HTMLButtonElement[];
    expect(inventoryAction?.getAttribute('aria-label')).toBe('Inventorier Article bloqué');
    detailAction!.click();
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    const detail = stockPanel.querySelector('#stock-detail') as HTMLElement;
    expect(detail.textContent).toContain('7 unités');
    expect(detail.textContent).toContain('Stock non vendable');
    expect(detail).toBe(document.activeElement);
  });
});
