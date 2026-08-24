import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, firstValueFrom, map, of, switchMap, tap } from 'rxjs';
import { Article } from '../domain/article';
import { ArticleAttributesUpdateCommand } from './article-attributes-update-command';
import { CatalogueGateway } from './catalogue-gateway';
import { CATALOGUE_GATEWAY } from './catalogue-gateway-token';
import { toCatalogueProblem } from './to-catalogue-problem';

@Injectable()
export class ArticleDetailsStore {
  private readonly gateway = inject(CATALOGUE_GATEWAY);
  private readonly ean13Requests = new Subject<string>();
  private readonly articleSignal = signal<Article | null>(null);
  private readonly stateSignal = signal<'loading' | 'ready' | 'error'>('loading');
  private readonly errorSignal = signal('');
  private readonly fieldErrorsSignal = signal<Record<string, string[]>>({});
  private readonly submittingSignal = signal(false);
  private readonly messageSignal = signal('');
  private mutationRequestId = 0;

  readonly article = this.articleSignal.asReadonly();
  readonly state = this.stateSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();
  readonly fieldErrors = this.fieldErrorsSignal.asReadonly();
  readonly submitting = this.submittingSignal.asReadonly();
  readonly message = this.messageSignal.asReadonly();

  constructor() {
    this.ean13Requests.pipe(
      tap(() => {
        this.stateSignal.set('loading');
        this.errorSignal.set('');
        this.articleSignal.set(null);
      }),
      switchMap((ean13) => this.gateway.get(ean13).pipe(
        map((article) => ({ article, kind: 'success' as const })),
        catchError((error: unknown) => of({
          kind: 'error' as const,
          problem: toCatalogueProblem(error, 'Article introuvable.'),
        })),
      )),
      takeUntilDestroyed(),
    ).subscribe((result) => {
      if (result.kind === 'error') {
        this.stateSignal.set('error');
        this.errorSignal.set(result.problem.title);
        return;
      }
      this.articleSignal.set(result.article);
      this.stateSignal.set('ready');
    });
  }

  load(ean13: string): void {
    this.mutationRequestId += 1;
    this.ean13Requests.next(ean13);
  }

  updatePrice(priceHtCents: number): Promise<Article | null> {
    const article = this.articleSignal();
    return article ? this.mutate(this.gateway.updatePrice(article.ean13, priceHtCents), 'Le Prix HT a été mis à jour.') : Promise.resolve(null);
  }

  updateAttributes(command: ArticleAttributesUpdateCommand): Promise<Article | null> {
    const article = this.articleSignal();
    return article ? this.mutate(this.gateway.updateAttributes(article.ean13, command), 'Les attributs ont été mis à jour.') : Promise.resolve(null);
  }

  toggleLifecycle(): Promise<Article | null> {
    const article = this.articleSignal();
    if (!article) return Promise.resolve(null);
    const result = article.status === 'active'
      ? this.gateway.archive(article.ean13)
      : this.gateway.reactivate(article.ean13);
    return this.mutate(result, article.status === 'active' ? 'Article archivé.' : 'Article réactivé.');
  }

  private async mutate(result: ReturnType<CatalogueGateway['get']>, message: string): Promise<Article | null> {
    const requestId = ++this.mutationRequestId;
    this.submittingSignal.set(true);
    this.errorSignal.set('');
    this.fieldErrorsSignal.set({});
    this.messageSignal.set('');
    try {
      const updated = await firstValueFrom(result);
      if (requestId !== this.mutationRequestId) return null;
      this.articleSignal.set(updated);
      this.messageSignal.set(message);
      return updated;
    } catch (error) {
      if (requestId !== this.mutationRequestId) return null;
      const problem = toCatalogueProblem(error, 'La modification a échoué.');
      this.errorSignal.set(problem.title);
      this.fieldErrorsSignal.set(problem.fieldErrors);
      return null;
    } finally {
      if (requestId === this.mutationRequestId) this.submittingSignal.set(false);
    }
  }
}
