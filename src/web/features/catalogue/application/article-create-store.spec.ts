import { TestBed } from '@angular/core/testing';
import { throwError } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { ArticleCreateStore } from './article-create-store';
import { CATALOGUE_GATEWAY } from './catalogue-gateway-token';
import { FakeCatalogueGateway } from './testing/fake-catalogue-gateway';

describe('ArticleCreateStore', () => {
  let fake: FakeCatalogueGateway;
  let store: ArticleCreateStore;

  beforeEach(() => {
    fake = new FakeCatalogueGateway();
    TestBed.configureTestingModule({ providers: [
      ArticleCreateStore,
      { provide: CATALOGUE_GATEWAY, useValue: fake },
    ] });
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
});
