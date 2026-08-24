import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, firstValueFrom, map, of, switchMap, tap } from 'rxjs';
import { ArticleSummary } from '../domain/article-summary';
import { CATALOGUE_GATEWAY } from './catalogue-gateway-token';
import { CatalogueQuery } from './catalogue-query';
import { toCatalogueProblem } from './to-catalogue-problem';

@Injectable()
export class CatalogueListStore {
  private readonly gateway = inject(CATALOGUE_GATEWAY);
  private readonly queries = new Subject<CatalogueQuery>();
  private readonly articlesSignal = signal<readonly ArticleSummary[]>([]);
  private readonly stateSignal = signal<'loading' | 'ready' | 'empty' | 'error'>('loading');
  private readonly errorSignal = signal('');
  private readonly staleSignal = signal(false);
  private readonly transitioningEanSignal = signal('');
  private readonly lifecycleMessageSignal = signal('');
  private currentQuery: CatalogueQuery = { status: 'active' };

  readonly articles = this.articlesSignal.asReadonly();
  readonly state = this.stateSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();
  readonly stale = this.staleSignal.asReadonly();
  readonly transitioningEan = this.transitioningEanSignal.asReadonly();
  readonly lifecycleMessage = this.lifecycleMessageSignal.asReadonly();

  constructor() {
    this.queries.pipe(
      tap(() => {
        this.stateSignal.set('loading');
        this.errorSignal.set('');
        this.staleSignal.set(this.articlesSignal().length > 0);
      }),
      switchMap((query) => this.gateway.search(query).pipe(
        map((articles) => ({ articles, kind: 'success' as const })),
        catchError((error: unknown) => of({
          kind: 'error' as const,
          problem: toCatalogueProblem(error, 'Le Catalogue ne peut pas être chargé. Réessayez.'),
        })),
      )),
      takeUntilDestroyed(),
    ).subscribe((result) => {
      if (result.kind === 'error') {
        this.stateSignal.set('error');
        this.errorSignal.set(result.problem.title);
        this.staleSignal.set(this.articlesSignal().length > 0);
        return;
      }
      this.articlesSignal.set(result.articles);
      this.stateSignal.set(result.articles.length > 0 ? 'ready' : 'empty');
      this.staleSignal.set(false);
    });
  }

  search(query: CatalogueQuery): void {
    this.currentQuery = query;
    this.refresh();
  }

  refresh(): void {
    this.queries.next(this.currentQuery);
  }

  async toggleLifecycle(article: ArticleSummary): Promise<boolean> {
    // ponytail: lifecycle writes are globally serialized; split per EAN only if throughput requires it.
    if (this.transitioningEanSignal()) return false;
    this.transitioningEanSignal.set(article.ean13);
    this.lifecycleMessageSignal.set('');
    try {
      const updated = await firstValueFrom(
        article.status === 'active'
          ? this.gateway.archive(article.ean13)
          : this.gateway.reactivate(article.ean13),
      );
      this.lifecycleMessageSignal.set(`${updated.name} est ${updated.status === 'active' ? 'actif' : 'archivé'}.`);
      this.articlesSignal.update((articles) => this.currentQuery.status === 'all'
        ? articles.map((article) => article.ean13 === updated.ean13 ? updated : article)
        : articles.filter((article) => article.ean13 !== updated.ean13));
      this.stateSignal.set(this.articlesSignal().length > 0 ? 'ready' : 'empty');
      return true;
    } catch (error) {
      this.lifecycleMessageSignal.set(toCatalogueProblem(error, 'La transition du cycle de vie a échoué.').title);
      return false;
    } finally {
      this.transitioningEanSignal.set('');
    }
  }
}
