import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, map, of, switchMap, tap } from 'rxjs';
import { StockPosition } from '../domain/stock-position';
import { STOCK_GATEWAY } from './stock-gateway-token';
import { StockFailure } from './stock-failure';
import { StockPositionDetailState } from './stock-position-detail-state';
import { StockPositionLoadState } from './stock-position-load-state';

@Injectable()
export class StockPositionStore {
  private readonly gateway = inject(STOCK_GATEWAY);
  private readonly loadRequests = new Subject<string>();
  private readonly detailRequests = new Subject<string | null>();
  private readonly mutableState = signal<StockPositionLoadState>({ status: 'loading', positions: [] });
  private readonly mutableDetailState = signal<StockPositionDetailState>({ status: 'idle' });

  readonly state = this.mutableState.asReadonly();
  readonly detailState = this.mutableDetailState.asReadonly();

  constructor() {
    this.loadRequests.pipe(
      tap(() => this.mutableState.set({ status: 'loading', positions: [] })),
      switchMap((filter) => this.gateway.list().pipe(
        map((positions) => this.filterPositions(positions, filter)),
        map((positions): StockPositionLoadState => positions.length > 0
          ? { status: 'ready', positions }
          : { status: 'empty', positions: [] }),
        catchError((error: unknown) => of<StockPositionLoadState>({
          status: 'error',
          positions: [],
          message: this.errorMessage(error, 'Le Stock ne peut pas être chargé. Réessayez.'),
        })),
      )),
      takeUntilDestroyed(),
    ).subscribe((state) => this.mutableState.set(state));

    this.detailRequests.pipe(
      tap((ean13) => this.mutableDetailState.set(ean13 === null
        ? { status: 'idle' }
        : { status: 'loading' })),
      switchMap((ean13) => ean13 === null
        ? of<StockPositionDetailState>({ status: 'idle' })
        : this.gateway.getByEan13(ean13).pipe(
          map((position): StockPositionDetailState => ({ status: 'ready', position })),
          catchError((error: unknown) => of<StockPositionDetailState>({
            status: 'error',
            message: this.errorMessage(error, 'Le détail du Stock ne peut pas être chargé.'),
          })),
        )),
      takeUntilDestroyed(),
    ).subscribe((state) => this.mutableDetailState.set(state));
  }

  load(filter = ''): void {
    this.detailRequests.next(null);
    this.loadRequests.next(filter);
  }

  openDetail(ean13: string): void {
    this.detailRequests.next(ean13);
  }

  closeDetail(): void {
    this.detailRequests.next(null);
  }

  private filterPositions(positions: readonly StockPosition[], filter: string): readonly StockPosition[] {
    const normalizedFilter = filter.trim().toLocaleLowerCase('fr-FR');
    return normalizedFilter === ''
      ? positions
      : positions.filter((position) => position.ean13.includes(normalizedFilter)
        || position.name.toLocaleLowerCase('fr-FR').includes(normalizedFilter));
  }

  private errorMessage(error: unknown, fallback: string): string {
    return this.isStockFailure(error) ? error.title : fallback;
  }

  private isStockFailure(error: unknown): error is StockFailure {
    return typeof error === 'object'
      && error !== null
      && 'title' in error
      && typeof error.title === 'string';
  }
}
