import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { HistoryEntry } from '../domain/history-entry';
import { StockPosition } from '../domain/stock-position';
import { STOCK_GATEWAY } from './stock-gateway-token';
import { StockGateway } from './stock-gateway';
import { HistoryQuery } from './history-query';
import { HistoryStore } from './history-store';

const entry = (id: string): HistoryEntry => ({
  id,
  type: 'supply',
  timestampUtc: '2030-01-15T10:00:00Z',
  ean13: '0123456789012',
  articles: ['0123456789012'],
  lines: [],
});

class FakeStockGateway implements StockGateway {
  historyResponses: Observable<readonly HistoryEntry[]>[] = [];
  historyQueries: HistoryQuery[] = [];

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
    return this.historyResponses.shift() ?? of([]);
  }
}

describe('HistoryStore', () => {
  it('keeps only the latest explicit History query response', () => {
    const obsolete = new Subject<readonly HistoryEntry[]>();
    const latest = new Subject<readonly HistoryEntry[]>();
    const gateway = new FakeStockGateway();
    gateway.historyResponses.push(obsolete, latest);
    TestBed.configureTestingModule({
      providers: [HistoryStore, { provide: STOCK_GATEWAY, useValue: gateway }],
    });
    const store = TestBed.inject(HistoryStore);

    store.loadGlobal();
    store.loadArticle('0123456789012');
    latest.next([entry('latest')]);
    obsolete.next([entry('obsolete')]);

    expect(gateway.historyQueries).toEqual([
      { scope: 'global' },
      { scope: 'article', ean13: '0123456789012' },
    ]);
    expect(store.state()).toEqual({ status: 'ready', entries: [entry('latest')] });
    expect(store.query()).toEqual({ scope: 'article', ean13: '0123456789012' });
  });

  it('distinguishes empty and error states and retries the current query', () => {
    const gateway = new FakeStockGateway();
    gateway.historyResponses.push(
      of([]),
      throwError(() => ({ title: 'Historique indisponible', fieldErrors: {} })),
      of([entry('retried')]),
    );
    TestBed.configureTestingModule({
      providers: [HistoryStore, { provide: STOCK_GATEWAY, useValue: gateway }],
    });
    const store = TestBed.inject(HistoryStore);

    store.loadGlobal();
    expect(store.state()).toEqual({ status: 'empty', entries: [] });
    store.loadArticle('0123456789012');
    expect(store.state()).toEqual({ status: 'error', entries: [], message: 'Historique indisponible' });
    store.retry();

    expect(store.state()).toEqual({ status: 'ready', entries: [entry('retried')] });
    expect(gateway.historyQueries.at(-1)).toEqual({ scope: 'article', ean13: '0123456789012' });
  });
});
