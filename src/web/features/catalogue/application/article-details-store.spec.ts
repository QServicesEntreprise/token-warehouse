import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
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
});

const article = (ean13: string, name: string): Article => ({
  ean13,
  name,
  type: 'nonFood',
  priceHtCents: 100,
  packaging: 'new',
  isActive: true,
  status: 'active',
  priceQuotes: [],
});
