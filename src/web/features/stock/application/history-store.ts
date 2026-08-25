import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, map, of, switchMap, tap } from 'rxjs';
import { STOCK_GATEWAY } from './stock-gateway-token';
import type { HistoryLoadState } from './history-load-state';
import type { HistoryQuery } from './history-query';
import { stockFailureMessage } from './stock-failure-message';

@Injectable()
export class HistoryStore {
  private readonly gateway = inject(STOCK_GATEWAY);
  private readonly requests = new Subject<HistoryQuery>();
  private readonly mutableQuery = signal<HistoryQuery | null>(null);
  private readonly mutableState = signal<HistoryLoadState>({ status: 'idle', entries: [] });

  readonly query = this.mutableQuery.asReadonly();
  readonly state = this.mutableState.asReadonly();

  constructor() {
    this.requests.pipe(
      tap((query) => {
        this.mutableQuery.set(query);
        this.mutableState.set({ status: 'loading', entries: [] });
      }),
      switchMap((query) => this.gateway.history(query).pipe(
        map((entries): HistoryLoadState => entries.length > 0
          ? { status: 'ready', entries }
          : { status: 'empty', entries: [] }),
        catchError((error: unknown) => of<HistoryLoadState>({
          status: 'error',
          entries: [],
          message: stockFailureMessage(error, 'L’Historique ne peut pas être chargé. Réessayez.'),
        })),
      )),
      takeUntilDestroyed(),
    ).subscribe((state) => this.mutableState.set(state));
  }

  loadGlobal(): void {
    this.requests.next({ scope: 'global' });
  }

  loadArticle(ean13: string): void {
    this.requests.next({ scope: 'article', ean13 });
  }

  retry(): void {
    const query = this.mutableQuery();
    if (query) this.requests.next(query);
  }
}
