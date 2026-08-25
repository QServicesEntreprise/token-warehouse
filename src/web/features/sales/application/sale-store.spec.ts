import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaleResult } from '../domain/sale-result';
import type { SellableArticle } from '../domain/sellable-article';
import { LAST_SALE_STORAGE } from './last-sale-storage.token';
import { SaleStore } from './sale-store';
import { SALES_GATEWAY } from './sales-gateway.token';

const article = (ean13: string): SellableArticle => ({
  ean13,
  name: `Article ${ean13}`,
  type: 'nonFood',
  isActive: true,
  status: 'active',
  priceHtCents: 101,
  physicalQuantity: 8,
  sellableQuantity: 8,
  availability: 'AVAILABLE',
  reason: null,
  priceQuotes: [],
  packaging: 'new',
});

const result = (id: string): SaleResult => ({
  operation: {
    id,
    type: 'SALE',
    ean13: '0123456789012',
    quantity: 2,
    occurredAt: '2030-01-15T10:00:00+00:00',
  },
  financial: {
    context: null,
    unitPriceHtCents: 101,
    taxRate: { code: 'nonFood', ratio: '1/5', numerator: 1, denominator: 5 },
    amountHtCents: 202,
    vatCents: 40,
    amountTtcCents: 242,
  },
  position: {
    ...article('0123456789012'),
    physicalQuantity: 6,
    sellableQuantity: 6,
  },
});

describe('SaleStore', () => {
  const searchArticles = vi.fn();
  const record = vi.fn();
  const getById = vi.fn();
  const load = vi.fn();
  const save = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    searchArticles.mockReturnValue(of([]));
    TestBed.configureTestingModule({
      providers: [
        SaleStore,
        { provide: SALES_GATEWAY, useValue: { searchArticles, record, getById } },
        { provide: LAST_SALE_STORAGE, useValue: { load, save } },
      ],
    });
  });

  it('keeps only the latest cancellable search result', () => {
    const first = new Subject<SellableArticle[]>();
    searchArticles.mockReturnValueOnce(first).mockReturnValueOnce(of([article('7351353713578')]));
    const store = TestBed.inject(SaleStore);

    store.search('premier');
    store.search('second');
    first.next([article('0123456789012')]);

    expect(store.articles()).toEqual([article('7351353713578')]);
  });

  it('submits once per mutation and exposes server field errors', async () => {
    const pending = new Subject<SaleResult>();
    record.mockReturnValueOnce(pending).mockReturnValueOnce(throwError(() => ({
      kind: 'conflict',
      message: 'Le Stock vendable est insuffisant.',
      fieldErrors: { quantity: 'La quantité dépasse le Stock vendable.' },
    })));
    const store = TestBed.inject(SaleStore);
    store.selectArticle(article('0123456789012'));

    const first = store.record({ ean13: '0123456789012', quantity: 2 });
    const duplicate = store.record({ ean13: '0123456789012', quantity: 2 });
    pending.next(result('sale-1'));
    pending.complete();

    await expect(first).resolves.toBe(true);
    await expect(duplicate).resolves.toBe(false);
    expect(record).toHaveBeenCalledTimes(1);

    await expect(store.record({ ean13: '0123456789012', quantity: 9 })).resolves.toBe(false);
    expect(store.fieldErrors()).toEqual({ quantity: 'La quantité dépasse le Stock vendable.' });
    expect(store.statusMessage()).toBe('Le Stock vendable est insuffisant.');
  });

  it('cancels an obsolete mutation when another Article is selected', async () => {
    const pending = new Subject<SaleResult>();
    record.mockReturnValueOnce(pending).mockReturnValueOnce(of(result('sale-2')));
    const store = TestBed.inject(SaleStore);
    store.selectArticle(article('0123456789012'));

    const obsolete = store.record({ ean13: '0123456789012', quantity: 2 });
    store.selectArticle(article('7351353713578'));
    expect(store.submitting()).toBe(false);

    await expect(store.record({ ean13: '7351353713578', quantity: 2 })).resolves.toBe(true);
    await expect(obsolete).resolves.toBe(false);
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('restores the last Sale through the storage port', async () => {
    load.mockReturnValue('sale-1');
    getById.mockReturnValue(of(result('sale-1')));
    searchArticles.mockReturnValue(of([article('0123456789012')]));
    const store = TestBed.inject(SaleStore);

    await store.restore();

    expect(getById).toHaveBeenCalledWith('sale-1');
    expect(store.receipt()?.operation.id).toBe('sale-1');
    expect(store.selectedArticle()?.ean13).toBe('0123456789012');
  });

  it('ignores a delayed session restore after a newer Sale commits', async () => {
    const restored = new Subject<SaleResult>();
    load.mockReturnValue('old-sale');
    getById.mockReturnValue(restored);
    record.mockReturnValue(of(result('new-sale')));
    const store = TestBed.inject(SaleStore);

    store.restore();
    store.selectArticle(article('0123456789012'));
    await store.record({ ean13: '0123456789012', quantity: 2 });
    restored.next(result('old-sale'));
    restored.complete();

    expect(store.receipt()?.operation.id).toBe('new-sale');
    expect(save).toHaveBeenCalledWith('new-sale');
  });
});
