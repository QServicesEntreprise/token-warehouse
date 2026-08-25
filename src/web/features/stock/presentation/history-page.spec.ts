import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { HistoryQuery } from '../application/history-query';
import { HistoryStore } from '../application/history-store';
import { STOCK_GATEWAY } from '../application/stock-gateway-token';
import { StockGateway } from '../application/stock-gateway';
import { HistoryEntry } from '../domain/history-entry';
import { StockPosition } from '../domain/stock-position';
import { HistoryPage } from './history-page';

const ean13 = '0123456789012';
const base = (id: string) => ({
  id,
  timestampUtc: '2030-01-15T10:00:00Z',
  ean13,
  articles: [ean13],
  lines: [],
});

const entries: readonly HistoryEntry[] = [
  {
    ...base('supply-1'),
    type: 'supply',
    quantity: 2,
    stockEffect: 2,
    resultingPhysicalStock: 2,
    lines: [{ lineNumber: 1, ean13, quantity: 2, stockEffect: 2 }],
  },
  { ...base('inventory-1'), type: 'inventory', previousPhysicalStock: 2, countedQuantity: 4, difference: 2, resultingPhysicalStock: 4 },
  {
    ...base('sale-1'),
    type: 'saleStock',
    quantity: 2,
    financial: {
      context: 'takeaway',
      unitPriceHtCents: 100,
      taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
      amountHtCents: 200,
      vatCents: 11,
      amountTtcCents: 211,
    },
  },
  {
    ...base('counter-1'),
    type: 'counterMovement',
    sourceOperationId: 'sale-1',
    sourceOperationType: 'SALE_STOCK',
    justification: 'Correction requise',
    financialReversal: {
      sourceOperationId: 'sale-1',
      context: 'takeaway',
      unitPriceHtCents: 100,
      taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
      amountHtCents: -200,
      vatCents: -11,
      amountTtcCents: -211,
    },
  },
  { ...base('archive-1'), type: 'catalogArchive', previousStatus: 'active', nextStatus: 'archived' },
  { ...base('reactivate-1'), type: 'catalogReactivate', previousStatus: 'archived', nextStatus: 'active' },
  { ...base('dlc-1'), type: 'catalogDlcChange', changes: [{ field: 'DLC', before: '2030-01-15', after: '2030-01-16' }] },
  { ...base('packaging-1'), type: 'catalogPackagingChange', changes: [{ field: 'Packaging', before: 'new', after: 'refurbished' }] },
  { ...base('attribute-1'), type: 'catalogAttributeChange', changes: [{ field: 'Nom', before: 'Avant', after: 'Après' }] },
  { ...base('future-1'), type: 'unknown', sourceType: 'FUTURE_FACT' },
];

class FakeStockGateway implements StockGateway {
  readonly historyQueries: HistoryQuery[] = [];

  constructor(private readonly responses: Observable<readonly HistoryEntry[]>[]) {}

  list(): Observable<readonly StockPosition[]> {
    return of([]);
  }

  getByEan13(): Observable<StockPosition> {
    throw new Error('unused');
  }

  recordInventory(): Observable<never> {
    return throwError(() => new Error('Inventaire inattendu'));
  }

  recordBulkInventory(): Observable<never> {
    return throwError(() => new Error('Inventaire inattendu'));
  }

  getInventoryById(): Observable<never> {
    return throwError(() => new Error('Inventaire inattendu'));
  }

  recordSupply(): Observable<never> {
    return throwError(() => new Error('unused'));
  }

  recordBulkSupply(): Observable<never> {
    return throwError(() => new Error('unused'));
  }

  listCorrectableSources(): Observable<never> {
    return throwError(() => new Error('Correction inattendue'));
  }

  recordCounterMovement(): Observable<never> {
    return throwError(() => new Error('Correction inattendue'));
  }

  history(query: HistoryQuery): Observable<readonly HistoryEntry[]> {
    this.historyQueries.push(query);
    return this.responses.shift() ?? of([]);
  }
}

const createPage = (gateway: StockGateway) => TestBed.configureTestingModule({
  imports: [HistoryPage],
  providers: [
    provideRouter([]),
    HistoryStore,
    { provide: STOCK_GATEWAY, useValue: gateway },
  ],
}).createComponent(HistoryPage);

describe('HistoryPage', () => {
  it('renders the nine facts, their details and unknown facts as accessible read-only History', async () => {
    const fixture = createPage(new FakeStockGateway([of(entries)]));

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('#history-panel') as HTMLElement;
    const listText = panel.querySelector('#history-list')?.textContent ?? '';
    for (const label of [
      'Approvisionnement', 'Inventaire', 'Vente Stock', 'Contre-mouvement',
      'Archivage Catalogue', 'Réactivation Catalogue', 'Changement de DLC',
      'Changement de Packaging', 'Changement Catalogue', 'Fait historique inconnu',
    ]) expect(listText).toContain(label);
    expect(listText).toContain('Ligne 1');
    expect(listText).toContain('Écart+2');
    expect(listText).toContain('Montant TTC historique211 centimes');
    expect(listText).toContain('Inversion financière TTC-211 centimes');
    expect(listText).toContain('active → archived');
    expect(listText).toContain('DLC : 2030-01-15 → 2030-01-16');
    expect(panel.querySelector(`a[href="/catalogue/${ean13}"]`)?.textContent).toBe(ean13);
    expect(panel.querySelectorAll('button')).toHaveLength(2);
    expect(document.activeElement).toBe(panel.querySelector('#history-title'));
  });

  it('announces loading, empty and error states while keeping explicit global and Article queries', () => {
    const loading = new Subject<readonly HistoryEntry[]>();
    const gateway = new FakeStockGateway([
      loading,
      of([]),
      throwError(() => ({ title: 'Historique indisponible' })),
    ]);
    const fixture = createPage(gateway);
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('#history-panel') as HTMLElement;
    const state = () => panel.querySelector('#history-state')?.textContent ?? '';

    expect(state()).toContain('Chargement de l’Historique');
    loading.next([]);
    fixture.detectChanges();
    expect(state()).toContain('Aucun fait historique');

    const input = panel.querySelector('#history-ean13') as HTMLInputElement;
    input.value = ean13;
    input.dispatchEvent(new Event('input'));
    panel.querySelector('form')?.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(gateway.historyQueries.at(-1)).toEqual({ scope: 'article', ean13 });

    (panel.querySelector('button[type="button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(input.value).toBe('');
    expect(state()).toContain('Historique indisponible');
    expect(gateway.historyQueries.at(-1)).toEqual({ scope: 'global' });
  });
});
