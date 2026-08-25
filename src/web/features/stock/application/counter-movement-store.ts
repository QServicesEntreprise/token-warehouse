import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, firstValueFrom, map, of, switchMap, takeUntil, tap } from 'rxjs';
import type { CorrectableSource } from '../domain/correctable-source';
import type { CounterMovementResult } from '../domain/counter-movement-result';
import type { RecordCounterMovementCommand } from '../domain/record-counter-movement-command';
import { STOCK_GATEWAY } from './stock-gateway-token';
import type { StockFailure } from './stock-failure';

@Injectable()
export class CounterMovementStore {
  private readonly gateway = inject(STOCK_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);
  private readonly loadRequests = new Subject<void>();
  private readonly cancelSourceLoads = new Subject<void>();
  private readonly sourcesStateValue = signal<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle');
  private readonly sourcesValue = signal<readonly CorrectableSource[]>([]);
  private readonly messageValue = signal('');
  private readonly receiptValue = signal<CounterMovementResult | null>(null);
  private readonly fieldErrorsValue = signal<Record<string, string>>({});
  private readonly submittingValue = signal(false);

  readonly sourcesState = this.sourcesStateValue.asReadonly();
  readonly sources = this.sourcesValue.asReadonly();
  readonly message = this.messageValue.asReadonly();
  readonly receipt = this.receiptValue.asReadonly();
  readonly fieldErrors = this.fieldErrorsValue.asReadonly();
  readonly submitting = this.submittingValue.asReadonly();
  readonly positionsByEan13 = computed(() => Object.fromEntries(
    this.receiptValue()?.positions.map((position) => [position.ean13, position]) ?? [],
  ));

  constructor() {
    this.loadRequests.pipe(
      tap(() => {
        this.sourcesStateValue.set('loading');
        this.sourcesValue.set([]);
        this.messageValue.set('');
      }),
      switchMap(() => this.gateway.listCorrectableSources().pipe(
        takeUntil(this.cancelSourceLoads),
        map((sources) => ({ sources })),
        catchError((error: unknown) => of({
          error: this.failureFrom(error, 'Les Opérations corrigeables ne peuvent pas être chargées.'),
        })),
      )),
      takeUntilDestroyed(),
    ).subscribe((result) => {
      if ('error' in result) {
        this.sourcesStateValue.set('error');
        this.messageValue.set(result.error.title);
        return;
      }
      this.sourcesValue.set(result.sources);
      this.sourcesStateValue.set(result.sources.length > 0 ? 'ready' : 'empty');
    });
  }

  loadSources(): void {
    if (this.submittingValue()) {
      return;
    }
    this.loadRequests.next();
  }

  async record(command: RecordCounterMovementCommand): Promise<boolean> {
    if (this.submittingValue()) {
      return false;
    }
    this.cancelSourceLoads.next();
    this.submittingValue.set(true);
    this.receiptValue.set(null);
    this.fieldErrorsValue.set({});
    this.messageValue.set('');
    try {
      const receipt = await firstValueFrom(
        this.gateway.recordCounterMovement(command).pipe(takeUntilDestroyed(this.destroyRef)),
      );
      this.receiptValue.set(receipt);
      this.sourcesValue.update((sources) => sources.filter(({ id }) => id !== command.sourceOperationId));
      this.sourcesStateValue.set(this.sourcesValue().length > 0 ? 'ready' : 'empty');
      return true;
    } catch (error) {
      const failure = this.failureFrom(error, 'Le Contre-mouvement ne peut pas être enregistré.');
      this.fieldErrorsValue.set(Object.fromEntries(
        Object.entries(failure.fieldErrors).map(([field, messages]) => [field, messages[0] ?? 'Valeur invalide.']),
      ));
      this.messageValue.set(failure.title);
      return false;
    } finally {
      this.submittingValue.set(false);
    }
  }

  clearFieldError(field: 'sourceOperationId' | 'justification'): void {
    this.fieldErrorsValue.update((errors) => ({ ...errors, [field]: '' }));
  }

  private failureFrom(error: unknown, fallbackTitle: string): StockFailure {
    return typeof error === 'object' && error !== null && 'title' in error
      ? error as StockFailure
      : { fieldErrors: {}, title: fallbackTitle };
  }
}
