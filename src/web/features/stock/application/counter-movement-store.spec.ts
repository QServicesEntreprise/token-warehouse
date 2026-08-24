import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { CorrectableSource } from '../domain/correctable-source';
import { CounterMovementResult } from '../domain/counter-movement-result';
import { RecordCounterMovementCommand } from '../domain/record-counter-movement-command';
import { StockPosition } from '../domain/stock-position';
import { CounterMovementStore } from './counter-movement-store';
import { STOCK_GATEWAY } from './stock-gateway-token';
import { StockGateway } from './stock-gateway';

const source = (id: string): CorrectableSource => ({
  id,
  type: 'SUPPLY',
  timestampUtc: '2030-01-15T09:00:00Z',
  ean13: '0123456789012',
  lines: [{ lineNumber: 1, ean13: '0123456789012', stockEffect: 2 }],
});

const result: CounterMovementResult = {
  counterMovement: {
    id: 'counter-01',
    type: 'COUNTER_MOVEMENT',
    timestampUtc: '2030-01-15T10:00:00Z',
    sourceOperationId: 'supply-01',
    sourceOperationType: 'SUPPLY',
    justification: 'Erreur de saisie',
    lines: [{ lineNumber: 1, ean13: '0123456789012', sourceEffect: 2, inverseEffect: -2 }],
  },
  source: source('supply-01'),
  positions: [{
    ean13: '0123456789012',
    physicalQuantity: 5,
    sellableQuantity: 5,
    availability: 'available',
    nonSellableReason: null,
  }],
};

class FakeStockGateway implements StockGateway {
  sourceResponses: Observable<readonly CorrectableSource[]>[] = [];
  recordResponse: Observable<CounterMovementResult> = throwError(() => new Error('Correction absente'));

  list(): Observable<readonly StockPosition[]> {
    return of([]);
  }

  getByEan13(): Observable<StockPosition> {
    return throwError(() => new Error('Position absente'));
  }

  recordSupply(): Observable<never> {
    return throwError(() => new Error('Approvisionnement inattendu'));
  }

  recordBulkSupply(): Observable<never> {
    return throwError(() => new Error('Approvisionnement inattendu'));
  }

  listCorrectableSources(): Observable<readonly CorrectableSource[]> {
    return this.sourceResponses.shift() ?? of([]);
  }

  recordCounterMovement(_command: RecordCounterMovementCommand): Observable<CounterMovementResult> {
    return this.recordResponse;
  }

  history(): Observable<never> {
    return throwError(() => new Error('Historique inattendu'));
  }
}

describe('CounterMovementStore', () => {
  let gateway: FakeStockGateway;
  let store: CounterMovementStore;

  beforeEach(() => {
    gateway = new FakeStockGateway();
    TestBed.configureTestingModule({
      providers: [
        CounterMovementStore,
        { provide: STOCK_GATEWAY, useValue: gateway },
      ],
    });
    store = TestBed.inject(CounterMovementStore);
  });

  it('ignores an obsolete list of correctable sources', () => {
    const obsolete = new Subject<readonly CorrectableSource[]>();
    const latest = new Subject<readonly CorrectableSource[]>();
    gateway.sourceResponses.push(obsolete, latest);

    store.loadSources();
    store.loadSources();
    latest.next([source('latest')]);
    obsolete.next([source('obsolete')]);

    expect(store.sourcesState()).toBe('ready');
    expect(store.sources().map(({ id }) => id)).toEqual(['latest']);
  });

  it('keeps the committed result and removes its source', async () => {
    gateway.sourceResponses.push(of([source('supply-01')]));
    gateway.recordResponse = of(result);
    store.loadSources();

    await expect(store.record({
      sourceOperationId: 'supply-01',
      justification: 'Erreur de saisie',
    })).resolves.toBe(true);

    expect(store.receipt()).toBe(result);
    expect(store.sources()).toEqual([]);
    expect(store.sourcesState()).toBe('empty');
  });

  it('does not let an older source list undo a committed correction', async () => {
    const obsolete = new Subject<readonly CorrectableSource[]>();
    gateway.sourceResponses.push(of([source('supply-01')]), obsolete);
    gateway.recordResponse = of(result);
    store.loadSources();
    store.loadSources();

    await store.record({ sourceOperationId: 'supply-01', justification: 'Erreur de saisie' });
    obsolete.next([source('supply-01')]);

    expect(store.receipt()).toBe(result);
    expect(store.sources()).toEqual([]);
    expect(store.sourcesState()).toBe('empty');
  });

  it('keeps server errors attached to the correction fields', async () => {
    gateway.sourceResponses.push(of([source('supply-01')]));
    gateway.recordResponse = throwError(() => ({
      fieldErrors: { justification: ['La justification est obligatoire.'] },
      title: 'La correction est invalide.',
    }));
    store.loadSources();

    await expect(store.record({
      sourceOperationId: 'supply-01',
      justification: ' ',
    })).resolves.toBe(false);

    expect(store.fieldErrors()).toEqual({ justification: 'La justification est obligatoire.' });
    expect(store.message()).toBe('La correction est invalide.');
    expect(store.sources().map(({ id }) => id)).toEqual(['supply-01']);
  });
});
