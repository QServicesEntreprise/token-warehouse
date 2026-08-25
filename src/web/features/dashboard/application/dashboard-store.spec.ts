import { TestBed } from '@angular/core/testing';
import { Observable, Subject } from 'rxjs';
import { describe, expect, it } from 'vitest';
import type { Dashboard } from '../domain/dashboard';
import type { DashboardCalendar } from '../domain/dashboard-calendar';
import type { DashboardFilter } from '../domain/dashboard-filter';
import { DashboardFailure } from './dashboard-failure';
import { DashboardGateway } from './dashboard-gateway';
import { DashboardStore } from './dashboard-store';

const emptyDashboard = (name?: string): Dashboard => ({
  kpis: { physicalStock: 0, sellableStock: 0, nonSellableStock: 0 },
  alerts: { outOfStock: [], notSellable: [] },
  stockByArticle: name ? [{
    ean13: '0123456789012',
    name,
    articleType: 'food',
    lifecycleStatus: 'ACTIVE',
    physicalStock: 1,
    sellableStock: 1,
    nonSellableStock: 0,
    availability: 'AVAILABLE',
    reason: null,
  }] : [],
  flowsByDay: [],
  financial: null,
});

class FakeDashboardGateway extends DashboardGateway {
  readonly calendar = new Subject<DashboardCalendar>();
  readonly reads: Array<{ filter: DashboardFilter; result: Subject<Dashboard> }> = [];

  override getCalendar(): Observable<DashboardCalendar> {
    return this.calendar;
  }

  override getDashboard(filter: DashboardFilter): Observable<Dashboard> {
    const result = new Subject<Dashboard>();
    this.reads.push({ filter, result });
    return result;
  }
}

describe('DashboardStore', () => {
  const createStore = () => {
    TestBed.configureTestingModule({
      providers: [DashboardStore, { provide: DashboardGateway, useClass: FakeDashboardGateway }],
    });
    return {
      store: TestBed.inject(DashboardStore),
      gateway: TestBed.inject(DashboardGateway) as FakeDashboardGateway,
    };
  };

  it('loads the current warehouse month and exposes the Dashboard', () => {
    const { store, gateway } = createStore();

    store.load();
    expect(store.state()).toBe('loading');
    gateway.calendar.next({
      warehouseDate: '2030-03-15',
      currentMonth: { from: '2030-03-01', to: '2030-03-31' },
    });
    expect(gateway.reads[0]!.filter).toEqual({
      from: '2030-03-01',
      to: '2030-03-31',
      type: null,
      mode: null,
      packaging: null,
    });
    gateway.reads[0]!.result.next(emptyDashboard('Article courant'));

    expect(store.state()).toBe('ready');
    expect(store.dashboard()?.stockByArticle[0]?.name).toBe('Article courant');
  });

  it('cancels the previous filtered read so the newest result wins', () => {
    const { store, gateway } = createStore();
    store.load();
    gateway.calendar.next({
      warehouseDate: '2030-03-15',
      currentMonth: { from: '2030-03-01', to: '2030-03-31' },
    });
    gateway.reads[0]!.result.next(emptyDashboard());

    store.setFilter('type', 'food');
    store.read();
    const older = gateway.reads[1]!.result;
    store.setFilter('type', 'nonFood');
    store.setFilter('packaging', 'new');
    store.read();
    const newer = gateway.reads[2]!.result;

    expect(older.observed).toBe(false);
    older.next(emptyDashboard('Réponse ancienne'));
    newer.next(emptyDashboard('Article le plus récent'));
    expect(store.dashboard()?.stockByArticle[0]?.name).toBe('Article le plus récent');
  });

  it('cancels an in-flight read when the newest filter submission is invalid', () => {
    const { store, gateway } = createStore();
    store.load();
    gateway.calendar.next({
      warehouseDate: '2030-03-15',
      currentMonth: { from: '2030-03-01', to: '2030-03-31' },
    });
    gateway.reads[0]!.result.next(emptyDashboard());

    store.read();
    const inFlight = gateway.reads[1]!.result;
    store.setFilter('from', '');
    store.read();

    expect(inFlight.observed).toBe(false);
    inFlight.next(emptyDashboard('Réponse obsolète'));
    expect(store.state()).toBe('error');
    expect(store.dashboard()).toBeNull();
    expect(store.fieldErrors()).toEqual({ from: 'La date de début est requise.' });
  });

  it('exposes stable field errors and remains retryable', () => {
    const { store, gateway } = createStore();
    store.load();
    gateway.calendar.next({
      warehouseDate: '2030-03-15',
      currentMonth: { from: '2030-03-01', to: '2030-03-31' },
    });
    gateway.reads[0]!.result.error(new DashboardFailure(
      'La période est invalide.',
      { from: 'La date de début est invalide.' },
    ));

    expect(store.state()).toBe('error');
    expect(store.error()).toBe('La période est invalide.');
    expect(store.fieldErrors()).toEqual({ from: 'La date de début est invalide.' });

    store.read();
    gateway.reads[1]!.result.next(emptyDashboard('Article retrouvé'));
    expect(store.state()).toBe('ready');
  });
});
