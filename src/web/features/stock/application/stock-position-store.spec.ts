import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { CorrectableSource } from '../domain/correctable-source';
import { CounterMovementResult } from '../domain/counter-movement-result';
import { RecordCounterMovementCommand } from '../domain/record-counter-movement-command';
import { StockPosition } from '../domain/stock-position';
import { STOCK_GATEWAY } from './stock-gateway-token';
import { StockGateway } from './stock-gateway';
import { StockPositionStore } from './stock-position-store';

const position = (ean13: string, name: string): StockPosition => ({
  ean13,
  name,
  physicalQuantity: 5,
  sellableQuantity: 5,
  nonSellableQuantity: 0,
  availability: 'available',
  nonSellableReason: null,
});

class FakeStockGateway implements StockGateway {
  listResponses: Observable<readonly StockPosition[]>[] = [];
  detailResponses = new Map<string, Observable<StockPosition>>();

  list(): Observable<readonly StockPosition[]> {
    return this.listResponses.shift() ?? of([]);
  }

  getByEan13(ean13: string): Observable<StockPosition> {
    return this.detailResponses.get(ean13) ?? throwError(() => new Error('Position absente'));
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
}

describe('StockPositionStore', () => {
  let gateway: FakeStockGateway;
  let store: StockPositionStore;

  beforeEach(() => {
    gateway = new FakeStockGateway();
    TestBed.configureTestingModule({
      providers: [
        StockPositionStore,
        { provide: STOCK_GATEWAY, useValue: gateway },
      ],
    });
    store = TestBed.inject(StockPositionStore);
  });

  it('keeps only the latest filtered Stock response', () => {
    const obsolete = new Subject<readonly StockPosition[]>();
    const latest = new Subject<readonly StockPosition[]>();
    gateway.listResponses.push(obsolete, latest);

    store.load('ancien');
    expect(store.state()).toEqual({ status: 'loading', positions: [] });
    store.load('récent');
    latest.next([
      position('0123456789012', 'Article ancien'),
      position('4006381333931', 'Article récent'),
    ]);

    expect(store.state()).toEqual({
      status: 'ready',
      positions: [position('4006381333931', 'Article récent')],
    });
    obsolete.next([position('5901234123457', 'Article ancien')]);
    expect(store.state().status).toBe('ready');
    expect(store.state().positions.map(({ ean13 }) => ean13)).toEqual(['4006381333931']);
  });

  it('distinguishes empty and error states without stale positions', () => {
    gateway.listResponses.push(
      of([]),
      throwError(() => ({ title: 'Le Stock est indisponible.', fieldErrors: {} })),
    );

    store.load();
    expect(store.state()).toEqual({ status: 'empty', positions: [] });
    store.load();
    expect(store.state()).toEqual({
      status: 'error',
      positions: [],
      message: 'Le Stock est indisponible.',
    });
  });

  it('does not let an obsolete detail replace the latest selection', () => {
    const obsolete = new Subject<StockPosition>();
    const latest = new Subject<StockPosition>();
    gateway.detailResponses.set('0123456789012', obsolete);
    gateway.detailResponses.set('4006381333931', latest);

    store.openDetail('0123456789012');
    store.openDetail('4006381333931');
    latest.next(position('4006381333931', 'Article récent'));
    obsolete.next(position('0123456789012', 'Article ancien'));

    expect(store.detailState()).toEqual({
      status: 'ready',
      position: position('4006381333931', 'Article récent'),
    });
  });
});
