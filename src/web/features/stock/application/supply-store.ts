import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject, catchError, map, of, switchMap, tap } from 'rxjs';
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
  private readonly submissions = new Subject<{
    request: Observable<SupplyResult>;
    resolve: (succeeded: boolean) => void;
  }>();
  private activeSubmission: { resolve: (succeeded: boolean) => void } | null = null;

  readonly result = this.resultState.asReadonly();
  readonly fieldErrors = this.fieldErrorsState.asReadonly();
  readonly statusMessage = this.statusMessageState.asReadonly();
  readonly submitting = this.submittingState.asReadonly();

  constructor() {
    this.submissions.pipe(
      tap((submission) => {
        this.activeSubmission = submission;
        this.submittingState.set(true);
        this.resultState.set(null);
        this.fieldErrorsState.set({});
        this.statusMessageState.set('Réception de l’Approvisionnement…');
      }),
      switchMap((submission) => submission.request.pipe(
        map((result) => ({ submission, result, error: null })),
        catchError((error: unknown) => of({ submission, result: null, error })),
      )),
      takeUntilDestroyed(),
    ).subscribe(({ submission, result, error }) => {
      if (this.activeSubmission !== submission) return;

      if (result !== null) {
        this.resultState.set(result);
        this.statusMessageState.set(
          `Approvisionnement ${result.operation.id} enregistré le ${result.operation.occurredAt}.`,
        );
      } else {
        const failure = this.failureFrom(error);
        this.fieldErrorsState.set(Object.fromEntries(
          Object.entries(failure.fieldErrors).map(([field, messages]) => [field, messages[0] ?? 'Valeur invalide.']),
        ));
        this.statusMessageState.set(failure.title);
      }

      this.activeSubmission = null;
      this.submittingState.set(false);
      submission.resolve(result !== null);
    });

    this.destroyRef.onDestroy(() => {
      this.activeSubmission?.resolve(false);
      this.activeSubmission = null;
    });
  }

  async recordSupply(command: RecordSupplyCommand): Promise<boolean> {
    return this.record(() => this.gateway.recordSupply(command));
  }

  async recordBulkSupply(command: RecordBulkSupplyCommand): Promise<boolean> {
    return this.record(() => this.gateway.recordBulkSupply(command));
  }

  private record(request: () => Observable<SupplyResult>): Promise<boolean> {
    if (this.submittingState()) return Promise.resolve(false);

    return new Promise((resolve) => this.submissions.next({ request: request(), resolve }));
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
