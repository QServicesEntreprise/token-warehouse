import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { ArticleCreateStore } from './article-create-store';
import { CATALOGUE_GATEWAY } from './catalogue-gateway-token';
import { CatalogueListStore } from './catalogue-list-store';
import { FakeCatalogueGateway } from './testing/fake-catalogue-gateway';

describe('ArticleCreateStore', () => {
  let fake: FakeCatalogueGateway;
  let store: ArticleCreateStore;

  beforeEach(() => {
    fake = new FakeCatalogueGateway();
    TestBed.configureTestingModule({ providers: [
      ArticleCreateStore,
      CatalogueListStore,
      { provide: CATALOGUE_GATEWAY, useValue: fake },
    ] });
    TestBed.inject(CatalogueListStore);
    store = TestBed.inject(ArticleCreateStore);
  });

  it('keeps server errors on their fields', async () => {
    fake.createHandler = () => throwError(() => ({
      title: 'Création refusée',
      fieldErrors: { ean13: ['Checksum invalide.'] },
    }));

    const created = await store.create({
      ean13: '0123456789013',
      type: 'food',
      name: 'Test',
      priceHtCents: 100,
      dlc: '2030-01-15',
      consumptionModes: ['takeaway'],
    });

    expect(created).toBeNull();
    expect(store.fieldErrors()).toEqual({ ean13: ['Checksum invalide.'] });
    expect(store.error()).toBe('Création refusée');
  });

  it('returns the created Article and clears the pending state', async () => {
    const article = {
      ean13: '0123456789012',
      type: 'nonFood' as const,
      name: 'Batterie',
      priceHtCents: 2500,
      packaging: 'new' as const,
      status: 'active' as const,
      priceQuotes: [],
    };
    fake.createHandler = () => of(article);

    await expect(store.create(article)).resolves.toEqual(article);
    expect(store.submitting()).toBe(false);
    expect(store.error()).toBe('');
  });

  it('refreshes the cached Catalogue query after creation', async () => {
    let searches = 0;
    const article = {
      ean13: '0123456789012',
      type: 'nonFood' as const,
      name: 'Batterie',
      priceHtCents: 2500,
      packaging: 'new' as const,
      status: 'active' as const,
      priceQuotes: [],
    };
    fake.createHandler = () => of(article);
    fake.searchHandler = () => {
      searches += 1;
      return of([article]);
    };

    await store.create(article);

    expect(searches).toBe(1);
  });
});
