import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Observable, Subject, catchError, switchMap, tap, throwError } from 'rxjs';
import type { Dashboard } from '../domain/dashboard';
import type { DashboardCalendar } from '../domain/dashboard-calendar';
import type { DashboardFilter } from '../domain/dashboard-filter';
import { DashboardFailure } from './dashboard-failure';
import { DashboardGateway } from './dashboard-gateway';

@Injectable()
export class DashboardStore {
  private readonly gateway = inject(DashboardGateway);
  private readonly destroyRef = inject(DestroyRef);
  private readonly requests = new Subject<DashboardFilter | DashboardFailure | null>();
  private readonly currentCalendar = signal<DashboardCalendar | null>(null);
  private readonly currentFilters = signal<DashboardFilter>({
    from: '',
    to: '',
    type: null,
    mode: null,
    packaging: null,
  });
  private readonly currentDashboard = signal<Dashboard | null>(null);
  private readonly currentState = signal<'loading' | 'ready' | 'empty' | 'error'>('loading');
  private readonly currentError = signal('');
  private readonly currentFieldErrors = signal<Partial<Record<keyof DashboardFilter, string>>>({});

  readonly calendar = this.currentCalendar.asReadonly();
  readonly filters = this.currentFilters.asReadonly();
  readonly dashboard = this.currentDashboard.asReadonly();
  readonly state = this.currentState.asReadonly();
  readonly error = this.currentError.asReadonly();
  readonly fieldErrors = this.currentFieldErrors.asReadonly();

  constructor() {
    this.requests.pipe(
      tap(() => this.beginRead()),
      switchMap(request => (
        request instanceof DashboardFailure
          ? throwError(() => request)
          : request === null
            ? this.bootstrap()
            : this.gateway.getDashboard(request)
      ).pipe(
        catchError(error => {
          this.failRead(error);
          return EMPTY;
        }),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(dashboard => this.completeRead(dashboard));
  }

  load(): void {
    this.requests.next(null);
  }

  read(): void {
    const filter = this.currentFilters();
    const fieldErrors: Partial<Record<keyof DashboardFilter, string>> = {};
    if (!filter.from) fieldErrors.from = 'La date de début est requise.';
    if (!filter.to) fieldErrors.to = 'La date de fin est requise.';
    if (Object.keys(fieldErrors).length > 0) {
      this.requests.next(new DashboardFailure('Corrigez la période sélectionnée.', fieldErrors));
      return;
    }

    this.requests.next({ ...filter });
  }

  retry(): void {
    if (this.currentCalendar() === null) this.load();
    else this.read();
  }

  setFilter<Key extends keyof DashboardFilter>(field: Key, value: DashboardFilter[Key]): void {
    this.currentFilters.update(filter => ({ ...filter, [field]: value }));
  }

  private bootstrap(): Observable<Dashboard> {
    const calendar = this.currentCalendar();
    if (calendar !== null) {
      return this.gateway.getDashboard(this.currentFilters());
    }

    return this.gateway.getCalendar().pipe(
      tap(current => {
        this.currentCalendar.set(current);
        this.currentFilters.update(filter => ({
          ...filter,
          from: filter.from || current.currentMonth.from,
          to: filter.to || current.currentMonth.to,
        }));
      }),
      switchMap(() => this.gateway.getDashboard(this.currentFilters())),
    );
  }

  private beginRead(): void {
    this.currentDashboard.set(null);
    this.currentState.set('loading');
    this.currentError.set('');
    this.currentFieldErrors.set({});
  }

  private completeRead(dashboard: Dashboard): void {
    this.currentDashboard.set(dashboard);
    this.currentState.set(
      dashboard.stockByArticle.length > 0 || dashboard.financial !== null ? 'ready' : 'empty',
    );
  }

  private failRead(error: unknown): void {
    const failure = error instanceof DashboardFailure
      ? error
      : new DashboardFailure('Le Dashboard ne peut pas être chargé. Réessayez.');
    this.currentState.set('error');
    this.currentError.set(failure.message);
    this.currentFieldErrors.set(failure.fieldErrors);
  }
}
