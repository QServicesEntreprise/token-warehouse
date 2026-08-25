import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Article } from '../domain/article';
import { ArticleDetailsStore } from './article-details-store';
import { CATALOGUE_GATEWAY } from './catalogue-gateway-token';
import { CatalogueListStore } from './catalogue-list-store';
import { FakeCatalogueGateway } from './testing/fake-catalogue-gateway';

describe('ArticleDetailsStore', () => {
  let fake: FakeCatalogueGateway;
  let store: ArticleDetailsStore;

  beforeEach(() => {
    fake = new FakeCatalogueGateway();
    TestBed.configureTestingModule({ providers: [
      ArticleDetailsStore,
      CatalogueListStore,
      { provide: CATALOGUE_GATEWAY, useValue: fake },
    ] });
    TestBed.inject(CatalogueListStore);
    store = TestBed.inject(ArticleDetailsStore);
  });

  it('ignores a delayed detail after a newer EAN-13 is requested', () => {
    const first = new Subject<Article>();
    const second = new Subject<Article>();
    fake.getHandler = (ean13) => ean13 === '1111111111116' ? first : second;

    store.load('1111111111116');
    store.load('2222222222222');
    first.next(article('1111111111116', 'Ancien'));
    second.next(article('2222222222222', 'Courant'));

    expect(store.article()?.name).toBe('Courant');
    expect(store.state()).toBe('ready');
  });

  it('keeps only the latest price update', async () => {
    const first = new Subject<Article>();
    const second = new Subject<Article>();
    let committed = article('1111111111116', 'Courant');
    let request = 0;
    fake.getHandler = () => of(committed);
    fake.updatePriceHandler = () => ++request === 1 ? first : second;
    store.load('1111111111116');

    const firstUpdate = store.updatePrice(200);
    const secondUpdate = store.updatePrice(300);
    committed = { ...committed, priceHtCents: 300 };
    second.next(committed);
    second.complete();
    first.next({ ...article('1111111111116', 'Courant'), priceHtCents: 200 });
    first.complete();

    await Promise.all([firstUpdate, secondUpdate]);
    expect(store.article()?.priceHtCents).toBe(300);
    expect(store.message()).toContain('mis à jour');
  });

  it('keeps update errors on their field', async () => {
    fake.getHandler = () => of(article('1111111111116', 'Courant'));
    fake.updatePriceHandler = () => throwError(() => ({
      title: 'Prix refusé',
      fieldErrors: { priceHtCents: ['Le Prix HT est invalide.'] },
    }));
    store.load('1111111111116');

    await expect(store.updatePrice(-1)).resolves.toBeNull();
    expect(store.fieldErrors()).toEqual({ priceHtCents: ['Le Prix HT est invalide.'] });
    expect(store.error()).toBe('Prix refusé');
  });

  it('clears a previous mutation success when another Article is loaded', async () => {
    fake.getHandler = (ean13) => of(article(ean13, ean13 === '1111111111116' ? 'Premier' : 'Second'));
    fake.updatePriceHandler = () => of({ ...article('1111111111116', 'Premier'), priceHtCents: 200 });
    store.load('1111111111116');
    await store.updatePrice(200);

    store.load('2222222222222');

    expect(store.article()?.name).toBe('Second');
    expect(store.message()).toBe('');
  });

  it('clears previous mutation errors when another Article is loaded', async () => {
    fake.getHandler = (ean13) => of(article(ean13, ean13 === '1111111111116' ? 'Premier' : 'Second'));
    fake.updatePriceHandler = () => throwError(() => ({
      title: 'Prix refusé',
      fieldErrors: { priceHtCents: ['Le Prix HT est invalide.'] },
    }));
    store.load('1111111111116');
    await store.updatePrice(-1);

    store.load('2222222222222');

    expect(store.article()?.name).toBe('Second');
    expect(store.error()).toBe('');
    expect(store.fieldErrors()).toEqual({});
  });

  it('refreshes the cached Catalogue query after a committed detail mutation', async () => {
    let searches = 0;
    fake.getHandler = () => of(article('1111111111116', 'Courant'));
    fake.updatePriceHandler = () => of({ ...article('1111111111116', 'Courant'), priceHtCents: 200 });
    fake.searchHandler = () => {
      searches += 1;
      return of([]);
    };
    store.load('1111111111116');

    await store.updatePrice(200);

    expect(searches).toBe(1);
  });

  it('refreshes the Catalogue after a committed mutation superseded by another lookup', async () => {
    const pendingUpdate = new Subject<Article>();
    let searches = 0;
    fake.getHandler = (ean13) => of(article(ean13, ean13 === '1111111111116' ? 'Premier' : 'Second'));
    fake.updatePriceHandler = () => pendingUpdate;
    fake.searchHandler = () => {
      searches += 1;
      return of([]);
    };
    store.load('1111111111116');

    const update = store.updatePrice(200);
    store.load('2222222222222');
    pendingUpdate.next({ ...article('1111111111116', 'Premier'), priceHtCents: 200 });
    pendingUpdate.complete();

    await expect(update).resolves.toBeNull();
    expect(store.article()?.ean13).toBe('2222222222222');
    expect(store.submitting()).toBe(false);
    expect(searches).toBe(1);
  });

  it('keeps a newer mutation after an older ABA recovery read', async () => {
    const firstUpdate = new Subject<Article>();
    const secondUpdate = new Subject<Article>();
    const firstRecovery = new Subject<Article>();
    const secondRecovery = new Subject<Article>();
    let update = 0;
    let aLoads = 0;
    fake.getHandler = (ean13) => {
      if (ean13 !== '1111111111116') return of(article(ean13, 'Second'));
      aLoads += 1;
      if (aLoads <= 2) return of(article(ean13, 'Premier'));
      return aLoads === 3 ? firstRecovery : secondRecovery;
    };
    fake.updatePriceHandler = () => ++update === 1 ? firstUpdate : secondUpdate;
    store.load('1111111111116');
    const older = store.updatePrice(200);
    store.load('2222222222222');
    store.load('1111111111116');
    const newer = store.updatePrice(300);

    firstUpdate.next({ ...article('1111111111116', 'Premier'), priceHtCents: 200 });
    firstUpdate.complete();
    await older;
    secondUpdate.next({ ...article('1111111111116', 'Premier'), priceHtCents: 300 });
    secondUpdate.complete();
    await newer;
    secondRecovery.next({ ...article('1111111111116', 'Premier'), priceHtCents: 300 });
    secondRecovery.complete();
    firstRecovery.next({ ...article('1111111111116', 'Premier'), priceHtCents: 200 });
    firstRecovery.complete();

    expect(store.article()?.priceHtCents).toBe(300);
    expect(store.message()).toContain('mis à jour');
  });
});

const article = (ean13: string, name: string): Article => ({
  ean13,
  name,
  type: 'nonFood',
  priceHtCents: 100,
  packaging: 'new',
  status: 'active',
  priceQuotes: [],
});
