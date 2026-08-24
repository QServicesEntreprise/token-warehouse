import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { ArticleSummary } from '../domain/article-summary';
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
});

const article = (ean13: string, name: string): ArticleSummary => ({
  ean13,
  name,
  type: 'food',
  priceHtCents: 100,
  dlc: '2030-01-15',
  consumptionModes: ['takeaway'],
  isActive: true,
  status: 'active',
});
