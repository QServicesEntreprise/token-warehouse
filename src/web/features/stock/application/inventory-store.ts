import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, firstValueFrom, map, of, switchMap, tap } from 'rxjs';
import type { InventoryCommand } from '../domain/inventory-command';
import type { InventoryReceipt } from '../domain/inventory-receipt';
import { LAST_INVENTORY_STORAGE } from './last-inventory-storage-token';
import type { StockFailure } from './stock-failure';
import { STOCK_GATEWAY } from './stock-gateway-token';

const failureFrom = (error: unknown): StockFailure => (
  typeof error === 'object' && error !== null && 'fieldErrors' in error
    ? error as StockFailure
    : { title: 'L’Inventaire n’a pas pu être enregistré.', fieldErrors: {} }
);

@Injectable()
export class InventoryStore {
  private readonly gateway = inject(STOCK_GATEWAY);
  private readonly storage = inject(LAST_INVENTORY_STORAGE);
  private readonly destroyRef = inject(DestroyRef);
  private readonly receiptState = signal<InventoryReceipt | null>(null);
  private readonly submittingState = signal(false);
  private readonly errorState = signal('');
  private readonly fieldErrorsState = signal<Record<string, string[]>>({});
  private readonly restoreStateValue = signal<'loading' | 'ready' | 'empty' | 'error'>('empty');
  private readonly restoreRequests = new Subject<string | null>();

  readonly receipt = this.receiptState.asReadonly();
  readonly submitting = this.submittingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly fieldErrors = this.fieldErrorsState.asReadonly();
  readonly restoreState = this.restoreStateValue.asReadonly();

  constructor() {
    this.restoreRequests.pipe(
      tap((id) => {
        this.receiptState.set(null);
        this.restoreStateValue.set(id ? 'loading' : 'empty');
      }),
      switchMap((id) => id
        ? this.gateway.getInventoryById(id).pipe(
          map((receipt) => ({ receipt })),
          catchError(() => of({ error: true as const })),
        )
        : of({ empty: true as const })),
      takeUntilDestroyed(),
    ).subscribe((result) => {
      if ('receipt' in result) {
        this.receiptState.set(result.receipt);
        this.restoreStateValue.set('ready');
      } else if ('error' in result) {
        this.restoreStateValue.set('error');
      }
    });
  }

  async record(commands: readonly InventoryCommand[]): Promise<boolean> {
    if (this.submittingState()) {
      return false;
    }
    this.restoreRequests.next(null);
    this.submittingState.set(true);
    this.receiptState.set(null);
    this.errorState.set('');
    this.fieldErrorsState.set({});
    try {
      const request = commands.length === 1
        ? this.gateway.recordInventory(commands[0]!)
        : this.gateway.recordBulkInventory(commands);
      const receipt = await firstValueFrom(request.pipe(takeUntilDestroyed(this.destroyRef)));
      this.receiptState.set(receipt);
      this.restoreStateValue.set('ready');
      this.storage.save(receipt.id);
      return true;
    } catch (error) {
      const failure = failureFrom(error);
      this.errorState.set(failure.title);
      this.fieldErrorsState.set(failure.fieldErrors);
      return false;
    } finally {
      this.submittingState.set(false);
    }
  }

  restore(): void {
    this.restoreRequests.next(this.storage.load());
  }

  clearFieldError(field: string): void {
    this.fieldErrorsState.update((errors) => {
      const next = { ...errors };
      delete next[field];
      return next;
    });
  }
}
