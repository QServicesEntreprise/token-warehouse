import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, firstValueFrom } from 'rxjs';
import { RecordBulkSupplyCommand } from '../domain/record-bulk-supply-command';
import { RecordSupplyCommand } from '../domain/record-supply-command';
import { SupplyResult } from '../domain/supply-result';
import { STOCK_GATEWAY } from './stock-gateway-token';

@Injectable()
export class SupplyStore {
  private readonly gateway = inject(STOCK_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);
  private readonly resultState = signal<SupplyResult | null>(null);
  private readonly fieldErrorsState = signal<Record<string, string>>({});
  private readonly statusMessageState = signal('');
  private readonly submittingState = signal(false);
  private submissionVersion = 0;

  readonly result = this.resultState.asReadonly();
  readonly fieldErrors = this.fieldErrorsState.asReadonly();
  readonly statusMessage = this.statusMessageState.asReadonly();
  readonly submitting = this.submittingState.asReadonly();

  constructor() {
    this.destroyRef.onDestroy(() => { this.submissionVersion += 1; });
  }

  async recordSupply(command: RecordSupplyCommand): Promise<boolean> {
    return this.record(() => this.gateway.recordSupply(command));
  }

  async recordBulkSupply(command: RecordBulkSupplyCommand): Promise<boolean> {
    return this.record(() => this.gateway.recordBulkSupply(command));
  }

  rebaseFieldErrorsAfterLineRemoval(removedIndex: number): void {
    this.fieldErrorsState.update((errors) => Object.fromEntries(
      Object.entries(errors).flatMap(([field, message]) => {
        const match = field.match(/^lines\[(\d+)\](.*)$/);
        if (!match) return [[field, message]];
        const lineIndex = Number(match[1]);
        if (lineIndex === removedIndex) return [];
        return [[`lines[${lineIndex > removedIndex ? lineIndex - 1 : lineIndex}]${match[2]}`, message]];
      }),
    ));
  }

  private async record(request: () => Observable<SupplyResult>): Promise<boolean> {
    if (this.submittingState()) return false;

    const version = ++this.submissionVersion;
    this.submittingState.set(true);
    this.resultState.set(null);
    this.fieldErrorsState.set({});
    this.statusMessageState.set('Réception de l’Approvisionnement…');
    try {
      const result = await firstValueFrom(
        request().pipe(takeUntilDestroyed(this.destroyRef)),
      );
      if (version !== this.submissionVersion) return false;
      this.resultState.set(result);
      this.statusMessageState.set(
        `Approvisionnement ${result.operation.id} enregistré le ${result.operation.occurredAt}.`,
      );
      return true;
    } catch (error) {
      if (version !== this.submissionVersion) return false;
      const failure = this.failureFrom(error);
      this.fieldErrorsState.set(Object.fromEntries(
        Object.entries(failure.fieldErrors).map(([field, messages]) => [field, messages[0] ?? 'Valeur invalide.']),
      ));
      this.statusMessageState.set(failure.title);
      return false;
    } finally {
      if (version === this.submissionVersion) this.submittingState.set(false);
    }
  }

  private failureFrom(error: unknown): { title: string; fieldErrors: Record<string, string[]> } {
    return typeof error === 'object' && error !== null && 'title' in error && typeof error.title === 'string'
      ? {
        title: error.title,
        fieldErrors: 'fieldErrors' in error && typeof error.fieldErrors === 'object' && error.fieldErrors !== null
          ? error.fieldErrors as Record<string, string[]>
          : {},
      }
      : { title: 'L’Approvisionnement n’a pas pu être enregistré.', fieldErrors: {} };
  }
}
