import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, firstValueFrom, map, of, Subject, switchMap, takeUntil, tap } from 'rxjs';
import { SaleCommand } from '../domain/sale-command';
import { SaleResult } from '../domain/sale-result';
import { SellableArticle } from '../domain/sellable-article';
import { LAST_SALE_STORAGE } from './last-sale-storage.token';
import { SaleFailure } from './sale-failure';
import { SALES_GATEWAY } from './sales-gateway.token';

const failureFrom = (error: unknown): SaleFailure => (
  typeof error === 'object' && error !== null
    ? error as SaleFailure
    : { kind: 'error' }
);

@Injectable()
export class SaleStore {
  private readonly gateway = inject(SALES_GATEWAY);
  private readonly storage = inject(LAST_SALE_STORAGE);
  private readonly destroyRef = inject(DestroyRef);
  private readonly searchRequests = new Subject<string>();
  private readonly recordCancellation = new Subject<void>();
  private readonly articlesState = signal<SellableArticle[]>([]);
  private readonly searchStateValue = signal<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle');
  private readonly searchErrorValue = signal('');
  private readonly selectedArticleState = signal<SellableArticle | null>(null);
  private readonly receiptState = signal<SaleResult | null>(null);
  private readonly saleStateValue = signal<'ready' | 'loading' | 'validation' | 'conflict' | 'error' | 'success'>('ready');
  private readonly fieldErrorsState = signal<Record<string, string>>({});
  private readonly statusMessageState = signal('');
  private readonly submittingState = signal(false);
  private workflowVersion = 0;

  readonly articles = this.articlesState.asReadonly();
  readonly searchState = this.searchStateValue.asReadonly();
  readonly searchError = this.searchErrorValue.asReadonly();
  readonly selectedArticle = this.selectedArticleState.asReadonly();
  readonly receipt = this.receiptState.asReadonly();
  readonly saleState = this.saleStateValue.asReadonly();
  readonly fieldErrors = this.fieldErrorsState.asReadonly();
  readonly statusMessage = this.statusMessageState.asReadonly();
  readonly submitting = this.submittingState.asReadonly();

  constructor() {
    this.searchRequests.pipe(
      tap(() => {
        this.searchStateValue.set('loading');
        this.searchErrorValue.set('');
        this.articlesState.set([]);
        this.selectArticle(null);
      }),
      switchMap((search) => this.gateway.searchArticles(search).pipe(
        map((articles) => ({ articles })),
        catchError((error: unknown) => of({ error: failureFrom(error) })),
      )),
      takeUntilDestroyed(),
    ).subscribe((result) => {
      if ('error' in result) {
        this.searchStateValue.set('error');
        this.searchErrorValue.set(result.error.message ?? 'Les Articles ne peuvent pas être chargés. Réessayez.');
        return;
      }
      this.articlesState.set(result.articles);
      this.searchStateValue.set(result.articles.length > 0 ? 'ready' : 'empty');
    });
  }

  search(search: string): void {
    this.searchRequests.next(search.trim());
  }

  selectArticle(article: SellableArticle | null): void {
    this.workflowVersion += 1;
    this.recordCancellation.next();
    this.submittingState.set(false);
    this.selectedArticleState.set(article);
    this.receiptState.set(null);
    this.fieldErrorsState.set({});
    this.statusMessageState.set('');
    this.saleStateValue.set('ready');
  }

  async record(command: SaleCommand): Promise<boolean> {
    if (this.submittingState()) {
      return false;
    }

    const version = ++this.workflowVersion;
    this.submittingState.set(true);
    this.receiptState.set(null);
    this.fieldErrorsState.set({});
    this.saleStateValue.set('loading');
    this.statusMessageState.set('Validation de la Vente…');
    try {
      const receipt = await firstValueFrom(this.gateway.record(command).pipe(
        takeUntil(this.recordCancellation),
        takeUntilDestroyed(this.destroyRef),
      ));
      if (version !== this.workflowVersion) {
        return false;
      }
      this.receiptState.set(receipt);
      this.selectedArticleState.update((current) => current
        ? { ...current, ...receipt.position }
        : this.articleFromReceipt(receipt));
      this.saleStateValue.set('success');
      this.statusMessageState.set(`Vente ${receipt.operation.id} enregistrée.`);
      this.storage.save(receipt.operation.id);
      return true;
    } catch (error) {
      if (version !== this.workflowVersion) {
        return false;
      }
      const failure = failureFrom(error);
      this.fieldErrorsState.set(failure.fieldErrors ?? {});
      this.saleStateValue.set(failure.kind);
      this.statusMessageState.set(failure.message ?? 'La Vente n’a pas pu être enregistrée.');
      return false;
    } finally {
      if (version === this.workflowVersion) {
        this.submittingState.set(false);
      }
    }
  }

  restore(): Promise<void> {
    const operationId = this.storage.load();
    if (!operationId) {
      return Promise.resolve();
    }
    const version = ++this.workflowVersion;
    this.saleStateValue.set('loading');
    this.statusMessageState.set('Rechargement de la dernière Vente…');
    return this.restoreReceipt(operationId, version);
  }

  private async restoreReceipt(operationId: string, version: number): Promise<void> {
    try {
      const receipt = await firstValueFrom(this.gateway.getById(operationId).pipe(takeUntilDestroyed(this.destroyRef)));
      if (version !== this.workflowVersion) {
        return;
      }
      let selectedArticle = this.articleFromReceipt(receipt);
      try {
        const articles = await firstValueFrom(this.gateway.searchArticles(receipt.position.ean13).pipe(
          takeUntilDestroyed(this.destroyRef),
        ));
        selectedArticle = articles.find((article) => article.ean13 === receipt.position.ean13) ?? selectedArticle;
      } catch {
        // The server receipt remains authoritative when its optional quote refresh fails.
      }
      if (version !== this.workflowVersion) {
        return;
      }
      this.receiptState.set(receipt);
      this.selectedArticleState.set(selectedArticle);
      this.saleStateValue.set('success');
      this.statusMessageState.set(`Vente ${receipt.operation.id} rechargée.`);
    } catch (error) {
      if (version === this.workflowVersion) {
        this.saleStateValue.set('error');
        this.statusMessageState.set(failureFrom(error).message ?? 'La Vente enregistrée ne peut pas être relue.');
      }
    }
  }

  private articleFromReceipt(receipt: SaleResult): SellableArticle {
    return {
      ...receipt.position,
      priceHtCents: receipt.financial.unitPriceHtCents,
      priceQuotes: [],
    };
  }
}
