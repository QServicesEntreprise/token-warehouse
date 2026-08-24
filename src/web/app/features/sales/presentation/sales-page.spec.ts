import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LAST_SALE_STORAGE } from '../application/last-sale-storage.token';
import { SaleStore } from '../application/sale-store';
import { SALES_GATEWAY } from '../application/sales-gateway.token';
import { SaleResult } from '../domain/sale-result';
import { SellableArticle } from '../domain/sellable-article';
import { SalesPage } from './sales-page';

const article: SellableArticle = {
  ean13: '0123456789012',
  name: 'Café à emporter ou sur place',
  type: 'food',
  isActive: true,
  status: 'active',
  priceHtCents: 101,
  physicalQuantity: 8,
  sellableQuantity: 8,
  availability: 'AVAILABLE',
  reason: null,
  consumptionModes: ['takeaway', 'onsite'],
  priceQuotes: [{
    saleContext: 'takeaway',
    taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
    vatCents: 6,
    priceTtcCents: 107,
  }, {
    saleContext: 'onsite',
    taxRate: { code: 'onsite', ratio: '1/10', numerator: 1, denominator: 10 },
    vatCents: 10,
    priceTtcCents: 111,
  }],
};

const receipt: SaleResult = {
  operation: {
    id: 'sale-1',
    type: 'SALE',
    ean13: article.ean13,
    quantity: 3,
    occurredAt: '2030-01-15T10:00:00+00:00',
  },
  financial: {
    context: 'onsite',
    unitPriceHtCents: 101,
    taxRate: { code: 'onsite', ratio: '1/10', numerator: 1, denominator: 10 },
    amountHtCents: 303,
    vatCents: 30,
    amountTtcCents: 333,
  },
  position: {
    ...article,
    physicalQuantity: 5,
    sellableQuantity: 5,
  },
};

describe('SalesPage', () => {
  const searchArticles = vi.fn();
  const record = vi.fn();
  const getById = vi.fn();
  const load = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    searchArticles.mockReturnValue(of([article]));
    getById.mockReturnValue(of(receipt));
    load.mockReturnValue(null);
    TestBed.configureTestingModule({
      imports: [SalesPage],
      providers: [
        SaleStore,
        { provide: SALES_GATEWAY, useValue: { searchArticles, record, getById } },
        { provide: LAST_SALE_STORAGE, useValue: { load, save: vi.fn() } },
      ],
    });
  });

  it('requires a Sale Context then displays the exact server amounts', async () => {
    record.mockReturnValue(of(receipt));
    const fixture = TestBed.createComponent(SalesPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.searchArticles(article.ean13);
    component.selectArticle(article);
    fixture.detectChanges();

    const quantity = fixture.nativeElement.querySelector('#sale-quantity') as HTMLInputElement;
    quantity.value = '3';
    quantity.dispatchEvent(new Event('input'));

    await component.onSaleSubmit(new Event('submit'));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    expect(record).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('#sale-context input')).toBe(document.activeElement);

    (fixture.nativeElement.querySelector('#sale-context-onsite') as HTMLInputElement).click();
    await component.onSaleSubmit(new Event('submit'));
    fixture.detectChanges();

    expect(record).toHaveBeenCalledWith({ ean13: article.ean13, quantity: 3, context: 'onsite' });
    expect(fixture.nativeElement.querySelector('#sale-result').textContent).toContain('333 centimes');
  });

  it('keeps the draft and focuses the rejected server field', async () => {
    record.mockReturnValue(throwError(() => ({
      kind: 'conflict',
      message: 'Le Stock vendable est insuffisant.',
      fieldErrors: { quantity: 'La quantité dépasse le Stock vendable.' },
    })));
    const fixture = TestBed.createComponent(SalesPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectArticle({ ...article, type: 'nonFood', consumptionModes: undefined });
    fixture.detectChanges();

    const quantity = fixture.nativeElement.querySelector('#sale-quantity') as HTMLInputElement;
    quantity.value = '9';
    quantity.dispatchEvent(new Event('input'));

    await component.onSaleSubmit(new Event('submit'));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(component.saleModel().quantity).toBe('9');
    expect(fixture.nativeElement.querySelector('#sale-quantity')).toBe(document.activeElement);
    expect(fixture.nativeElement.querySelector('#sale-status').textContent).toContain('Stock vendable');
  });

  it('restores the receipt, selection and draft through the storage port', async () => {
    load.mockReturnValue('sale-1');
    const fixture = TestBed.createComponent(SalesPage);
    fixture.detectChanges();

    await vi.waitFor(() => expect(fixture.componentInstance.store.receipt()?.operation.id).toBe('sale-1'));
    fixture.detectChanges();

    expect(getById).toHaveBeenCalledWith('sale-1');
    expect(fixture.componentInstance.store.selectedArticle()?.ean13).toBe(article.ean13);
    expect((fixture.nativeElement.querySelector('#sale-quantity') as HTMLInputElement).value).toBe('3');
  });
});
