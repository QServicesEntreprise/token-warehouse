import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { ArticleSummary } from '../domain/article-summary';
import { Article } from '../domain/article';
import { CATALOGUE_GATEWAY } from './catalogue-gateway-token';
import { CatalogueListStore } from './catalogue-list-store';
import { CatalogueQuery } from './catalogue-query';
import { FakeCatalogueGateway } from './testing/fake-catalogue-gateway';

describe('CatalogueListStore', () => {
  let fake: FakeCatalogueGateway;
  let store: CatalogueListStore;

  beforeEach(() => {
    fake = new FakeCatalogueGateway();
    TestBed.configureTestingModule({ providers: [
      CatalogueListStore,
      { provide: CATALOGUE_GATEWAY, useValue: fake },
    ] });
    store = TestBed.inject(CatalogueListStore);
  });

  it('keeps only the latest search result', () => {
    const first = new Subject<readonly ArticleSummary[]>();
    const second = new Subject<readonly ArticleSummary[]>();
    fake.searchHandler = (query: CatalogueQuery) => query.search === 'first' ? first : second;

    store.search({ status: 'active', search: 'first' });
    store.search({ status: 'active', search: 'second' });
    first.next([article('1111111111116', 'Ancien')]);
    second.next([article('2222222222222', 'Courant')]);

    expect(store.articles().map(({ name }) => name)).toEqual(['Courant']);
    expect(store.state()).toBe('ready');
  });

  it('keeps the previous result when a refresh fails', () => {
    fake.searchHandler = () => of([article('1111111111116', 'Conservé')]);
    store.search({ status: 'active' });
    fake.searchHandler = () => throwError(() => ({ title: 'Catalogue indisponible' }));

    store.search({ status: 'active' });

    expect(store.articles().map(({ name }) => name)).toEqual(['Conservé']);
    expect(store.state()).toBe('error');
    expect(store.stale()).toBe(true);
  });

  it('ignores a pre-mutation search after the lifecycle change commits', async () => {
    const preMutationSearch = new Subject<readonly ArticleSummary[]>();
    const postMutationSearch = new Subject<readonly ArticleSummary[]>();
    let searches = 0;
    fake.searchHandler = () => {
      searches += 1;
      if (searches === 1) return of([article('1111111111116', 'À archiver')]);
      return searches === 2 ? preMutationSearch : postMutationSearch;
    };
    store.search({ status: 'active' });
    store.refresh();
    fake.archiveHandler = () => of({
      ean13: '1111111111116',
      type: 'food',
      name: 'À archiver',
      priceHtCents: 100,
      dlc: '2030-01-15',
      consumptionModes: ['takeaway'],
      status: 'archived',
      priceQuotes: [],
    });

    await store.toggleLifecycle(store.articles()[0]);
    postMutationSearch.next([]);
    preMutationSearch.next([article('1111111111116', 'Périmé')]);

    expect(searches).toBe(3);
    expect(store.articles()).toEqual([]);
    expect(store.state()).toBe('empty');
    expect(store.lifecycleMessage()).toContain('archivé');
  });

  it('does not start a second lifecycle transition while one is pending', async () => {
    const pending = new Subject<Article>();
    const calls: string[] = [];
    fake.searchHandler = () => of([
      article('1111111111116', 'Premier'),
      article('2222222222222', 'Second'),
    ]);
    fake.archiveHandler = (ean13) => {
      calls.push(ean13);
      return pending;
    };
    store.search({ status: 'active' });

    const first = store.toggleLifecycle(store.articles()[0]);
    const second = store.toggleLifecycle(store.articles()[1]);
    pending.next({ ...store.articles()[0], status: 'archived', priceQuotes: [] });
    pending.complete();

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
    expect(calls).toEqual(['1111111111116']);
  });
});

const article = (ean13: string, name: string): ArticleSummary => ({
  ean13,
  name,
  type: 'food',
  priceHtCents: 100,
  dlc: '2030-01-15',
  consumptionModes: ['takeaway'],
  status: 'active',
});
