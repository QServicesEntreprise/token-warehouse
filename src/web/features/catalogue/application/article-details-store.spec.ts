import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { Article } from '../domain/article';
import { ArticleDetailsStore } from './article-details-store';
import { CATALOGUE_GATEWAY } from './catalogue-gateway-token';
import { FakeCatalogueGateway } from './testing/fake-catalogue-gateway';

describe('ArticleDetailsStore', () => {
  let fake: FakeCatalogueGateway;
  let store: ArticleDetailsStore;

  beforeEach(() => {
    fake = new FakeCatalogueGateway();
    TestBed.configureTestingModule({ providers: [
      ArticleDetailsStore,
      { provide: CATALOGUE_GATEWAY, useValue: fake },
    ] });
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
    let request = 0;
    fake.getHandler = () => of(article('1111111111116', 'Courant'));
    fake.updatePriceHandler = () => ++request === 1 ? first : second;
    store.load('1111111111116');

    const firstUpdate = store.updatePrice(200);
    const secondUpdate = store.updatePrice(300);
    second.next({ ...article('1111111111116', 'Courant'), priceHtCents: 300 });
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
