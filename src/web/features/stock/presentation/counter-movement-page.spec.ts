import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { STOCK_GATEWAY } from '../application/stock-gateway-token';
import type { StockGateway } from '../application/stock-gateway';
import type { CorrectableSource } from '../domain/correctable-source';
import type { CounterMovementResult } from '../domain/counter-movement-result';
import type { InventoryCommand } from '../domain/inventory-command';
import type { InventoryReceipt } from '../domain/inventory-receipt';
import type { RecordCounterMovementCommand } from '../domain/record-counter-movement-command';
import type { StockPosition } from '../domain/stock-position';
import { CounterMovementStore } from '../application/counter-movement-store';
import { CounterMovementPage } from './counter-movement-page';

const correctableSource: CorrectableSource = {
  id: 'supply-01',
  type: 'SUPPLY',
  timestampUtc: '2030-01-15T09:00:00Z',
  ean13: '0123456789012',
  lines: [{ lineNumber: 1, ean13: '0123456789012', stockEffect: 2 }],
};

class FakeStockGateway implements StockGateway {
  list(): Observable<readonly StockPosition[]> {
    return of([]);
  }

  getByEan13(): Observable<StockPosition> {
    return throwError(() => new Error('Position absente'));
  }

  recordInventory(_command: InventoryCommand): Observable<InventoryReceipt> {
    return throwError(() => new Error('Inventaire inattendu'));
  }

  recordBulkInventory(_commands: readonly InventoryCommand[]): Observable<InventoryReceipt> {
    return throwError(() => new Error('Inventaire inattendu'));
  }

  getInventoryById(): Observable<InventoryReceipt> {
    return throwError(() => new Error('Inventaire inattendu'));
  }

  recordSupply(): Observable<never> {
    return throwError(() => new Error('Approvisionnement inattendu'));
  }

  recordBulkSupply(): Observable<never> {
    return throwError(() => new Error('Approvisionnement inattendu'));
  }

  listCorrectableSources(): Observable<readonly CorrectableSource[]> {
    return of([correctableSource]);
  }

  recordCounterMovement(_command: RecordCounterMovementCommand): Observable<CounterMovementResult> {
    return throwError(() => ({
      fieldErrors: { justification: ['Justification refusée par le serveur.'] },
      title: 'Le Contre-mouvement est refusé.',
    }));
  }

  history(): Observable<never> {
    return throwError(() => new Error('Historique inattendu'));
  }
}

describe('CounterMovementPage', () => {
  it('keeps the justification and its server error attached to the form', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [CounterMovementPage],
      providers: [
        CounterMovementStore,
        { provide: STOCK_GATEWAY, useClass: FakeStockGateway },
      ],
    }).createComponent(CounterMovementPage);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('#counter-movement-load') as HTMLButtonElement).click();
    fixture.detectChanges();
    const source = fixture.nativeElement.querySelector('#counter-movement-source') as HTMLSelectElement;
    source.value = 'supply-01';
    source.dispatchEvent(new Event('input'));
    const justification = fixture.nativeElement.querySelector('#counter-movement-justification') as HTMLTextAreaElement;
    justification.value = 'Correction conservée';
    justification.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('#counter-movement-submit') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(justification.value).toBe('Correction conservée');
    expect(justification.getAttribute('aria-describedby')).toBe('counter-movement-justification-error');
    expect(fixture.nativeElement.querySelector('#counter-movement-justification-error').textContent)
      .toContain('Justification refusée par le serveur.');
  });
});
