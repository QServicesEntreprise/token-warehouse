import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { AppComponent } from './app.component';
import { ArticleResponse } from './article-api.service';

describe('AppComponent', () => {
  afterEach(() => sessionStorage.clear());

  it('searches Articles on the server and renders only the committed sale result', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    http.expectOne('/api/stock').flush([]);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.saleSearch.set('Batterie');
    const search = component.searchSaleArticles();
    const searchRequest = http.expectOne(
      (request) => request.method === 'GET'
        && request.url === '/api/sales/articles'
        && request.params.get('search') === 'Batterie',
    );
    searchRequest.flush([{
      ean13: '0123456789012',
      name: 'Batterie industrielle',
      type: 'nonFood',
      isActive: true,
      status: 'active',
      priceHtCents: 101,
      physicalQuantity: 8,
      sellableQuantity: 8,
      availability: 'AVAILABLE',
      reason: null,
      packaging: 'new',
    }]);
    await search;

    component.selectSaleArticle(component.saleArticles()[0]);
    component.saleQuantity.set('3');
    const submission = component.onSaleSubmit(new Event('submit'));
    const saleRequest = http.expectOne('/api/sales');
    expect(saleRequest.request.body).toEqual({ ean13: '0123456789012', quantity: 3 });
    expect(component.saleReceipt()).toBeNull();
    saleRequest.flush({
      operation: {
        id: 'sale-1',
        type: 'SALE',
        ean13: '0123456789012',
        quantity: 3,
        occurredAt: '2030-01-15T10:00:00+00:00',
      },
      financial: {
        context: null,
        unitPriceHtCents: 101,
        taxRate: { code: 'nonFood', ratio: '1/5', numerator: 1, denominator: 5 },
        amountHtCents: 303,
        vatCents: 61,
        amountTtcCents: 364,
      },
      position: {
        ean13: '0123456789012',
        name: 'Batterie industrielle',
        type: 'nonFood',
        isActive: true,
        status: 'active',
        physicalQuantity: 5,
        sellableQuantity: 5,
        availability: 'AVAILABLE',
        reason: null,
        packaging: 'new',
      },
    });
    await submission;
    fixture.detectChanges();

    expect(component.saleState()).toBe('success');
    expect(fixture.nativeElement.querySelector('#sale-result').textContent).toContain('364');
    expect(component.stockPositions()[0].physicalQuantity).toBe(5);
    http.verify();
  });

  it('ignores a delayed previous sale restore after a newer sale commits', async () => {
    sessionStorage.setItem('token-warehouse.last-sale-id', 'old-sale');
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    http.expectOne('/api/stock').flush([]);
    const delayedRestore = http.expectOne('/api/sales/old-sale');

    const makeSaleResponse = (id: string, name: string, quantity: number, physicalQuantity: number) => ({
      operation: {
        id,
        type: 'SALE',
        ean13: '0123456789012',
        quantity,
        occurredAt: '2030-01-15T10:00:00+00:00',
      },
      financial: {
        context: null,
        unitPriceHtCents: 101,
        taxRate: { code: 'nonFood', ratio: '1/5', numerator: 1, denominator: 5 },
        amountHtCents: quantity === 2 ? 202 : 101,
        vatCents: quantity === 2 ? 40 : 20,
        amountTtcCents: quantity === 2 ? 242 : 121,
      },
      position: {
        ean13: '0123456789012',
        name,
        type: 'nonFood',
        isActive: true,
        status: 'active',
        physicalQuantity,
        sellableQuantity: physicalQuantity,
        availability: 'AVAILABLE',
        reason: null,
        packaging: 'new',
      },
    });

    const component = fixture.componentInstance;
    const article = {
      ean13: '0123456789012',
      name: 'Article courant',
      type: 'nonFood' as const,
      isActive: true,
      status: 'active' as const,
      priceHtCents: 101,
      physicalQuantity: 8,
      sellableQuantity: 8,
      availability: 'AVAILABLE' as const,
      reason: null,
      packaging: 'new' as const,
    };
    component.saleArticles.set([article]);
    component.selectSaleArticle(article);
    component.saleQuantity.set('2');

    const submission = component.onSaleSubmit(new Event('submit'));
    const saleRequest = http.expectOne('/api/sales');
    saleRequest.flush(makeSaleResponse('new-sale', 'Article courant', 2, 6));
    await submission;

    delayedRestore.flush(makeSaleResponse('old-sale', 'Ancienne Vente', 1, 7));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.saleReceipt()?.operation.id).toBe('new-sale');
    expect(component.selectedSaleArticle()?.name).toBe('Article courant');
    expect(component.saleQuantity()).toBe('2');
    expect(component.saleState()).toBe('success');
    expect(component.stockPositions()[0].physicalQuantity).toBe(6);
    expect(component.stockPositions()[0].sellableQuantity).toBe(6);
    expect(fixture.nativeElement.querySelector('#sale-result').textContent).toContain('new-sale');
    http.verify();
  });

  it('ignores an in-flight sale after a newer Article selection', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    http.expectOne('/api/stock').flush([
      {
        ean13: '0123456789012',
        name: 'Article A',
        type: 'nonFood',
        isActive: true,
        status: 'active',
        physicalQuantity: 8,
        sellableQuantity: 8,
        availability: 'AVAILABLE',
        reason: null,
        packaging: 'new',
      },
      {
        ean13: '7351353713578',
        name: 'Article B',
        type: 'nonFood',
        isActive: true,
        status: 'active',
        physicalQuantity: 4,
        sellableQuantity: 4,
        availability: 'AVAILABLE',
        reason: null,
        packaging: 'new',
      },
    ]);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    const articleA = {
      ean13: '0123456789012',
      name: 'Article A',
      type: 'nonFood' as const,
      isActive: true,
      status: 'active' as const,
      priceHtCents: 101,
      physicalQuantity: 8,
      sellableQuantity: 8,
      availability: 'AVAILABLE' as const,
      reason: null,
      packaging: 'new' as const,
    };
    const articleB = {
      ...articleA,
      ean13: '7351353713578',
      name: 'Article B',
      physicalQuantity: 4,
      sellableQuantity: 4,
    };
    component.saleArticles.set([articleA, articleB]);
    component.selectSaleArticle(articleA);
    component.saleQuantity.set('2');

    const submission = component.onSaleSubmit(new Event('submit'));
    const saleRequest = http.expectOne('/api/sales');
    component.selectSaleArticle(articleB);
    component.saleQuantity.set('1');
    saleRequest.flush({
      operation: {
        id: 'sale-a',
        type: 'SALE',
        ean13: articleA.ean13,
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
        ...articleA,
        physicalQuantity: 6,
        sellableQuantity: 6,
      },
    });
    await submission;
    fixture.detectChanges();

    expect(component.saleReceipt()).toBeNull();
    expect(component.selectedSaleArticle()?.ean13).toBe(articleB.ean13);
    expect(component.selectedSaleArticle()?.name).toBe('Article B');
    expect(component.saleState()).toBe('ready');
    expect(component.saleSubmitting()).toBe(false);
    expect(component.stockPositions().find((position) => position.ean13 === articleA.ean13)?.physicalQuantity).toBe(8);
    expect(component.stockPositions().find((position) => position.ean13 === articleB.ean13)?.physicalQuantity).toBe(4);
    http.verify();
  });

  it('keeps the sale draft and exposes a conflict after a server rejection', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    http.expectOne('/api/stock').flush([]);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.saleArticles.set([{
      ean13: '0123456789012',
      name: 'Batterie industrielle',
      type: 'nonFood',
      isActive: true,
      status: 'active',
      priceHtCents: 101,
      physicalQuantity: 8,
      sellableQuantity: 8,
      availability: 'AVAILABLE',
      reason: null,
      packaging: 'new',
    }]);
    component.selectSaleArticle(component.saleArticles()[0]);
    component.saleQuantity.set('9');
    const submission = component.onSaleSubmit(new Event('submit'));
    const saleRequest = http.expectOne('/api/sales');
    saleRequest.flush(
      {
        code: 'OUT_OF_STOCK',
        title: 'Le Stock vendable est insuffisant.',
        errors: { quantity: ['La quantité demandée dépasse le Stock vendable courant.'] },
      },
      { status: 409, statusText: 'Conflict' },
    );
    await submission;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(component.saleQuantity()).toBe('9');
    expect(component.saleState()).toBe('conflict');
    expect(component.saleReceipt()).toBeNull();
    expect(fixture.nativeElement.querySelector('#sale-quantity').value).toBe('9');
    expect(fixture.nativeElement.querySelector('#sale-quantity')).toBe(document.activeElement);
    http.verify();
  });

  it('submits an inventory and renders the server reconciliation receipt', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    http.expectOne('/api/stock').flush([]);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.inventoryModel.set({ ean13: '0123456789012', countedQuantity: '11' });
    const submission = component.onInventorySubmit(new Event('submit'));
    const request = http.expectOne('/api/inventories');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ ean13: '0123456789012', countedQuantity: 11 });
    request.flush({
      operation: {
        id: 'operation-1',
        type: 'INVENTORY',
        ean13: '0123456789012',
        previousPhysicalStock: 8,
        countedQuantity: 11,
        inventoryDifference: 3,
        resultingPhysicalStock: 11,
        timestampUtc: '2030-01-15T10:00:00+00:00',
      },
      position: {
        ean13: '0123456789012',
        physicalStock: 11,
        sellableStock: 11,
        availability: 'AVAILABLE',
        reason: null,
      },
    });
    await submission;
    http.expectOne('/api/stock').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.inventoryReceipt()?.operation.inventoryDifference).toBe(3);
    expect(fixture.nativeElement.querySelector('#inventory-result').textContent).toContain('+3');
    expect(fixture.nativeElement.querySelector('#inventory-result').textContent).toContain('11');
    http.verify();
  });

  it('submits several lines to the bulk endpoint and renders every server result', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    http.expectOne('/api/stock').flush([]);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.inventoryLines.set([
      { ean13: '0123456789012', countedQuantity: '11' },
      { ean13: '7351353713578', countedQuantity: '2' },
      { ean13: '0360002914522', countedQuantity: '0' },
    ]);
    const submission = component.onInventorySubmit(new Event('submit'));
    const request = http.expectOne('/api/inventories/bulk');
    expect(request.request.body).toEqual({
      lines: [
        { ean13: '0123456789012', countedQuantity: 11 },
        { ean13: '7351353713578', countedQuantity: 2 },
        { ean13: '0360002914522', countedQuantity: 0 },
      ],
    });
    request.flush({
      operation: {
        id: 'operation-bulk-1',
        type: 'INVENTORY',
        timestampUtc: '2030-01-15T10:00:00+00:00',
        lines: [
          {
            lineNumber: 1,
            ean13: '0123456789012',
            previousPhysicalStock: 8,
            countedQuantity: 11,
            inventoryDifference: 3,
            resultingPhysicalStock: 11,
            position: { ean13: '0123456789012', physicalStock: 11, sellableStock: 11, availability: 'AVAILABLE', reason: null },
          },
          {
            lineNumber: 2,
            ean13: '7351353713578',
            previousPhysicalStock: 5,
            countedQuantity: 2,
            inventoryDifference: -3,
            resultingPhysicalStock: 2,
            position: { ean13: '7351353713578', physicalStock: 2, sellableStock: 2, availability: 'AVAILABLE', reason: null },
          },
          {
            lineNumber: 3,
            ean13: '0360002914522',
            previousPhysicalStock: 0,
            countedQuantity: 0,
            inventoryDifference: 0,
            resultingPhysicalStock: 0,
            position: { ean13: '0360002914522', physicalStock: 0, sellableStock: 0, availability: 'OUT_OF_STOCK', reason: null },
          },
        ],
      },
    });
    await submission;
    http.expectOne('/api/stock').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#inventory-result').textContent).toContain('+3');
    expect(fixture.nativeElement.querySelector('#inventory-result').textContent).toContain('-3');
    expect(fixture.nativeElement.querySelector('#inventory-result').textContent).toContain('Écart d’inventaire0');
    expect(component.inventoryReceipt()?.operation.id).toBe('operation-bulk-1');
    http.verify();
  });

  it('keeps every bulk line and focuses the first server error after rejection', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    http.expectOne('/api/stock').flush([]);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.inventoryLines.set([
      { ean13: '0123456789012', countedQuantity: '11' },
      { ean13: '7351353713578', countedQuantity: '2' },
    ]);
    const submission = component.onInventorySubmit(new Event('submit'));
    const request = http.expectOne('/api/inventories/bulk');
    request.flush(
      {
        code: 'INVALID_INPUT',
        title: 'Le lot est invalide.',
        errors: {
          'lines[0].ean13': ['EAN inconnu.'],
          'lines[1].countedQuantity': ['Quantité invalide.'],
        },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await submission;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#inventory-ean13').value).toBe('0123456789012');
    expect(fixture.nativeElement.querySelector('#inventory-countedQuantity-1').value).toBe('2');
    expect(fixture.nativeElement.querySelector('#inventory-ean13-error').textContent).toContain('EAN inconnu');
    expect(fixture.nativeElement.querySelector('#inventory-countedQuantity-1-error').textContent).toContain('Quantité invalide');
    expect(fixture.nativeElement.querySelector('#inventory-ean13')).toBe(document.activeElement);
    expect(component.inventoryReceipt()).toBeNull();
    http.verify();
  });

  it('keeps inventory input and maps a server error to the accessible form', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    http.expectOne('/api/stock').flush([]);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.inventoryModel.set({ ean13: '0123456789012', countedQuantity: '5' });
    const submission = component.onInventorySubmit(new Event('submit'));
    const request = http.expectOne('/api/inventories');
    request.flush(
      { code: 'POSITION_CONFLICT', title: 'La position a changé.' },
      { status: 409, statusText: 'Conflict' },
    );
    await submission;
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.inventoryModel().countedQuantity).toBe('5');
    expect(fixture.nativeElement.querySelector('#inventory-error').textContent).toContain('position');
    expect(fixture.nativeElement.querySelector('#inventory-countedQuantity')).toBe(document.activeElement);
    http.verify();
  });

  it('announces Stock loading, empty and error states and retries the request', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    const initialStock = http.expectOne('/api/stock');
    expect(fixture.componentInstance.stockState()).toBe('loading');
    expect(fixture.nativeElement.querySelector('#stock-state').textContent).toContain('Chargement du Stock');
    initialStock.flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.stockState()).toBe('empty');
    expect(fixture.nativeElement.querySelector('#stock-state').textContent).toContain('Aucun Article');

    fixture.componentInstance.retryStock();
    const failedStock = http.expectOne('/api/stock');
    failedStock.flush({ title: 'Le Stock est indisponible.' }, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.stockState()).toBe('error');
    expect(fixture.nativeElement.querySelector('#stock-state [role="alert"]').textContent).toContain('indisponible');

    fixture.componentInstance.retryStock();
    const retry = http.expectOne('/api/stock');
    retry.flush([
      {
        ean13: '0123456789012',
        name: 'Article retrouvé',
        type: 'food',
        isActive: true,
        status: 'active',
        physicalQuantity: 0,
        sellableQuantity: 0,
        availability: 'OUT_OF_STOCK',
        reason: null,
      },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.stockState()).toBe('ready');
    expect(fixture.nativeElement.querySelector('#stock-table').textContent).toContain('Rupture');
    http.verify();
  });

  it('renders the server Stock contract and opens its keyboard-usable detail', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    const stock = http.expectOne('/api/stock');
    stock.flush([
      {
        ean13: '0123456789012',
        name: 'Alimentaire double mode',
        type: 'food',
        isActive: true,
        status: 'active',
        physicalQuantity: 5,
        sellableQuantity: 5,
        availability: 'AVAILABLE',
        reason: null,
        dlc: '2030-01-15',
        consumptionModes: ['takeaway', 'onsite'],
      },
      {
        ean13: '4006381333931',
        name: 'Alimentaire expiré',
        type: 'food',
        isActive: true,
        status: 'active',
        physicalQuantity: 7,
        sellableQuantity: 0,
        availability: 'NOT_SELLABLE',
        reason: 'DLC_EXPIRED',
        dlc: '2030-01-14',
        consumptionModes: ['takeaway'],
      },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.stockState()).toBe('ready');
    expect(fixture.nativeElement.querySelector('#stock-state').textContent).toContain('2 Articles trouvés');
    expect(fixture.nativeElement.querySelector('#stock-table').textContent).toContain('5');
    expect(fixture.nativeElement.querySelector('#stock-table').textContent).toContain('7');
    expect(fixture.nativeElement.querySelector('#stock-table').textContent).toContain('DLC dépassée');

    const detailPromise = component.openStockPosition(component.stockPositions()[0]);
    const detailRequest = http.expectOne('/api/stock/0123456789012');
    expect(detailRequest.request.method).toBe('GET');
    detailRequest.flush({
      ean13: '0123456789012',
      name: 'Alimentaire double mode',
      type: 'food',
      isActive: true,
      status: 'active',
      physicalQuantity: 5,
      sellableQuantity: 5,
      availability: 'AVAILABLE',
      reason: null,
      dlc: '2030-01-15',
      consumptionModes: ['takeaway', 'onsite'],
    });
    await detailPromise;
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(component.stockDetail()?.ean13).toBe('0123456789012');
    expect(fixture.nativeElement.querySelector('#stock-detail').textContent).toContain('Stock physique');
    expect(fixture.nativeElement.querySelector('#stock-detail').textContent).toContain('Stock vendable');
    expect(fixture.nativeElement.querySelector('#stock-detail button, #stock-detail a')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#stock-detail')).toBe(document.activeElement);

    const failedDetailPromise = component.openStockPosition(component.stockPositions()[1]);
    const failedDetailRequest = http.expectOne('/api/stock/4006381333931');
    failedDetailRequest.flush(
      { title: 'Le détail du Stock est indisponible.' },
      { status: 500, statusText: 'Server Error' },
    );
    await failedDetailPromise;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#stock-detail-error').textContent)
      .toContain('indisponible');

    flushUnusedStockRequest(http);
    http.verify();
  });

  it('engages the supply response without optimistic stock and keeps drafts on error', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    http.expectOne('/api/stock').flush([]);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.supplyModel.set({ ean13: '0123456789012', quantity: '3' });
    const submission = component.onSupplySubmit(new Event('submit'));
    const request = http.expectOne('/api/supplies');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ ean13: '0123456789012', quantity: 3 });
    expect(component.stockPositions()).toEqual([]);
    request.flush({
      operation: {
        id: 'server-operation-1',
        type: 'supply',
        ean13: '0123456789012',
        quantity: 3,
        occurredAt: '2030-01-15T10:00:00Z',
      },
      position: {
        ean13: '0123456789012',
        name: 'Article reçu',
        type: 'food',
        isActive: true,
        status: 'active',
        physicalQuantity: 3,
        sellableQuantity: 3,
        availability: 'AVAILABLE',
        reason: null,
      },
    });
    await submission;
    fixture.detectChanges();

    expect(component.stockPositions()[0]?.physicalQuantity).toBe(3);
    expect(fixture.nativeElement.querySelector('#supply-status').textContent).toContain('server-operation-1');

    component.supplyModel.update((model) => ({ ...model, quantity: '0' }));
    const failedSubmission = component.onSupplySubmit(new Event('submit'));
    const failedRequest = http.expectOne('/api/supplies');
    failedRequest.flush(
      { code: 'supply.validation', title: 'La quantité est invalide.', errors: { quantity: ['Quantité invalide.'] } },
      { status: 400, statusText: 'Bad Request' },
    );
    await failedSubmission;
    fixture.detectChanges();

    expect(component.supplyModel().ean13).toBe('0123456789012');
    expect(component.supplyModel().quantity).toBe('0');
    expect(fixture.nativeElement.querySelector('#supply-quantity-error').textContent).toContain('invalide');
    expect(fixture.nativeElement.querySelector('#supplyQuantity')).toBe(document.activeElement);
    http.verify();
  });

  it('refreshes the open Article detail from the committed supply position', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    http.expectOne('/api/stock').flush([]);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    const article = foodArticle(1000, 55, 1055, 100, 1100);
    article.stock = { physicalQuantity: 8, sellableQuantity: 8 };
    component.lookupEan.set(article.ean13);
    const lookup = component.onLookup(new Event('submit'));
    http.expectOne(`/api/articles/${article.ean13}`).flush(article);
    await lookup;
    fixture.detectChanges();

    component.supplyModel.set({ ean13: article.ean13, quantity: '3' });
    const submission = component.onSupplySubmit(new Event('submit'));
    const request = http.expectOne('/api/supplies');
    request.flush({
      operation: {
        id: 'server-operation-detail',
        type: 'supply',
        ean13: article.ean13,
        quantity: 3,
        occurredAt: '2030-01-15T10:00:00Z',
      },
      position: {
        ean13: article.ean13,
        name: article.name,
        type: 'food',
        isActive: true,
        status: 'active',
        physicalQuantity: 11,
        sellableQuantity: 11,
        availability: 'AVAILABLE',
        reason: null,
      },
    });
    await submission;
    fixture.detectChanges();

    expect(component.detail()?.stock).toEqual({ physicalQuantity: 11, sellableQuantity: 11 });
    expect(fixture.nativeElement.querySelector('.article-detail').textContent).toContain('11 unités');
    http.verify();
  });

  it('submits multiple supply lines and maps a rejected line without losing drafts', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    http.expectOne('/api/stock').flush([]);
    await fixture.whenStable();

    const valueEvent = (value: string) => ({ target: { value } } as unknown as Event);
    const component = fixture.componentInstance;
    component.setSupplyLineField(0, 'ean13', valueEvent('0123456789012'));
    component.setSupplyLineField(0, 'quantity', valueEvent('3'));
    component.addSupplyLine();
    component.setSupplyLineField(1, 'ean13', valueEvent('5901234123457'));
    component.setSupplyLineField(1, 'quantity', valueEvent('2'));

    const submission = component.onSupplySubmit(new Event('submit'));
    const request = http.expectOne('/api/supplies/bulk');
    expect(request.request.body).toEqual({
      lines: [
        { ean13: '0123456789012', quantity: 3 },
        { ean13: '5901234123457', quantity: 2 },
      ],
    });
    expect(component.stockPositions()).toEqual([]);
    request.flush({
      operation: {
        id: 'bulk-operation-1',
        type: 'supply',
        occurredAt: '2030-01-15T10:00:00Z',
        lines: [
          { lineNumber: 1, ean13: '0123456789012', quantity: 3 },
          { lineNumber: 2, ean13: '5901234123457', quantity: 2 },
        ],
      },
      positions: [
        {
          ean13: '0123456789012',
          name: 'Premier Article',
          type: 'food',
          isActive: true,
          status: 'active',
          physicalQuantity: 11,
          sellableQuantity: 11,
          availability: 'AVAILABLE',
          reason: null,
        },
        {
          ean13: '5901234123457',
          name: 'Second Article',
          type: 'food',
          isActive: true,
          status: 'active',
          physicalQuantity: 7,
          sellableQuantity: 7,
          availability: 'AVAILABLE',
          reason: null,
        },
      ],
    });
    await submission;
    fixture.detectChanges();

    expect(component.stockPositions().map((position) => position.physicalQuantity)).toEqual([11, 7]);
    expect(fixture.nativeElement.querySelector('#supply-status').textContent).toContain('bulk-operation-1');

    component.setSupplyLineField(1, 'quantity', valueEvent('0'));
    const failedSubmission = component.onSupplySubmit(new Event('submit'));
    const failedRequest = http.expectOne('/api/supplies/bulk');
    failedRequest.flush(
      {
        code: 'bulk_supply.validation',
        title: 'La livraison est invalide.',
        errors: { 'lines[1].quantity': ['La quantité est invalide.'] },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await failedSubmission;
    fixture.detectChanges();

    expect(component.supplyLines()[0]).toEqual({ ean13: '0123456789012', quantity: '3' });
    expect(component.supplyLines()[1]).toEqual({ ean13: '5901234123457', quantity: '0' });
    expect(fixture.nativeElement.querySelector('#supply-quantity-1-error').textContent).toContain('invalide');
    expect(fixture.nativeElement.querySelector('#supplyQuantity-1')).toBe(document.activeElement);
    expect(component.stockPositions().map((position) => position.physicalQuantity)).toEqual([11, 7]);

    component.removeSupplyLine(0);
    fixture.detectChanges();
    expect(component.supplyLines()).toEqual([{ ean13: '5901234123457', quantity: '0' }]);
    expect(fixture.nativeElement.querySelector('#supply-quantity-error').textContent).toContain('invalide');
    http.verify();
  });

  it('shows only the fields applicable to the selected classification', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('#dlc')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#packaging')).toBeNull();

    const type = fixture.nativeElement.querySelector('#type') as HTMLSelectElement;
    type.value = 'nonFood';
    type.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#dlc')).toBeNull();
    expect(fixture.nativeElement.querySelector('#consumptionModes')).toBeNull();
    expect(fixture.nativeElement.querySelector('#packaging')).not.toBeNull();
  });

  it('maps a server conflict to the EAN field and live error region', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component.model.set({
      ean13: '0123456789012',
      type: 'food',
      name: 'Chocolat noir',
      priceHtCents: '199',
      dlc: '2026-12-31',
      consumptionModes: ['takeaway'],
      packaging: '',
    });
    fixture.detectChanges();

    const submission = component.onSubmit(new Event('submit'));
    const request = http.expectOne((candidate) => candidate.method === 'POST' && candidate.url === '/api/articles');
    request.flush(
      {
        code: 'article.ean13.conflict',
        errors: { ean13: ['Un Article utilise déjà cet EAN-13.'] },
      },
      { status: 409, statusText: 'Conflict' },
    );
    await submission;
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.articleForm.ean13().errors().some((error) => error.kind === 'server')).toBe(true);
    expect(fixture.nativeElement.querySelector('#ean13-error').textContent).toContain('EAN');
    expect(fixture.nativeElement.querySelector('#form-error')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#ean13')).toBe(document.activeElement);
    flushUnusedStockRequest(http);
    http.verify();
  });

  it('loads the catalogue and serializes every selected filter', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    const initial = http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles');
    expect(initial.request.params.get('status')).toBe('active');
    initial.flush([
      {
        ean13: '0123456789012',
        type: 'food',
        name: 'Café du Comptoir',
        priceHtCents: 199,
        isActive: true,
        dlc: '2026-12-31',
        consumptionModes: ['takeaway'],
      },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.catalogSearch.set(' Café ');
    component.catalogStatus.set('all');
    component.catalogType.set('food');
    component.catalogMode.set('takeaway');
    const search = component.onCatalogSubmit(new Event('submit'));
    const request = http.expectOne((candidate) => candidate.method === 'GET' && candidate.url === '/api/articles');
    expect(request.request.params.get('status')).toBe('all');
    expect(request.request.params.get('search')).toBe('Café');
    expect(request.request.params.get('type')).toBe('food');
    expect(request.request.params.get('mode')).toBe('takeaway');
    expect(request.request.params.has('packaging')).toBe(false);
    request.flush([]);
    await search;
    fixture.detectChanges();

    expect(component.catalogState()).toBe('empty');
    expect(fixture.nativeElement.textContent).toContain('Aucun Article ne correspond');
    flushUnusedStockRequest(http);
    http.verify();
  });

  it('marks a previous catalogue result as stale after an error and ignores an older response', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    const initial = http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles');
    initial.flush([
      {
        ean13: '0123456789012',
        type: 'food',
        name: 'Café du Comptoir',
        priceHtCents: 199,
        isActive: true,
        dlc: '2026-12-31',
        consumptionModes: ['takeaway'],
      },
    ]);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    const failedSearch = component.onCatalogSubmit(new Event('submit'));
    const failed = http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles');
    failed.flush({ title: 'Le Catalogue est indisponible.' }, { status: 503, statusText: 'Unavailable' });
    await failedSearch;
    fixture.detectChanges();

    expect(component.catalogState()).toBe('error');
    expect(component.catalogStale()).toBe(true);
    expect(fixture.nativeElement.querySelector('#catalog-stale')).not.toBeNull();

    const oldRequest = component.onCatalogSubmit(new Event('submit'));
    const newRequest = component.onCatalogSubmit(new Event('submit'));
    const pending = http.match((request) => request.method === 'GET' && request.url === '/api/articles');
    expect(pending).toHaveLength(2);
    pending[0].flush([
      {
        ean13: '4006381333931',
        type: 'nonFood',
        name: 'Ancienne réponse',
        priceHtCents: 100,
        isActive: true,
        packaging: 'new',
      },
    ]);
    pending[1].flush([
      {
        ean13: '7351353713578',
        type: 'nonFood',
        name: 'Réponse courante',
        priceHtCents: 200,
        isActive: true,
        packaging: 'refurbished',
      },
    ]);
    await Promise.all([oldRequest, newRequest]);

    expect(component.catalogArticles().map((article) => article.name)).toEqual(['Réponse courante']);
    expect(component.catalogState()).toBe('ready');
    flushUnusedStockRequest(http);
    http.verify();
  });

  it('archives a catalogue row through the API and reloads the active view', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    const initial = http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles');
    initial.flush([
      {
        ean13: '0123456789012',
        type: 'food',
        name: 'Café du Comptoir',
        priceHtCents: 199,
        isActive: true,
        status: 'active',
        dlc: '2026-12-31',
        consumptionModes: ['takeaway'],
      },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    const action = fixture.nativeElement.querySelector('[aria-label="Archiver Café du Comptoir"]') as HTMLButtonElement;
    expect(action).not.toBeNull();
    action.click();
    const archive = http.expectOne('/api/articles/0123456789012/archive');
    expect(archive.request.method).toBe('POST');
    archive.flush({
      ean13: '0123456789012',
      type: 'food',
      name: 'Café du Comptoir',
      priceHtCents: 199,
      isActive: false,
      status: 'archived',
      dlc: '2026-12-31',
      consumptionModes: ['takeaway'],
      priceQuotes: [],
    });
    await fixture.whenStable();
    const reload = http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles');
    expect(reload.request.params.get('status')).toBe('active');
    reload.flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Archivé');
    expect(fixture.nativeElement.querySelector('[aria-label="Archiver Café du Comptoir"]')).toBeNull();
    flushUnusedStockRequest(http);
    http.verify();
  });

  it('actualise après un succès obsolète sans remplacer le message le plus récent', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    const initial = http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles');
    initial.flush([
      {
        ean13: '0123456789012',
        type: 'food',
        name: 'Café du Comptoir',
        priceHtCents: 199,
        isActive: true,
        status: 'active',
        dlc: '2026-12-31',
        consumptionModes: ['takeaway'],
      },
      {
        ean13: '7351353713578',
        type: 'nonFood',
        name: 'Batterie atelier',
        priceHtCents: 2500,
        isActive: true,
        status: 'active',
        packaging: 'new',
      },
    ]);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.lookupEan.set('0123456789012');
    const detailLookup = component.onLookup(new Event('submit'));
    const detailRequest = http.expectOne('/api/articles/0123456789012');
    detailRequest.flush({
      ean13: '0123456789012',
      type: 'food',
      name: 'Café du Comptoir',
      priceHtCents: 199,
      isActive: true,
      status: 'active',
      dlc: '2026-12-31',
      consumptionModes: ['takeaway'],
      priceQuotes: [{
        saleContext: 'takeaway',
        taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
        vatCents: 11,
        priceTtcCents: 210,
      }],
    });
    await detailLookup;
    fixture.detectChanges();

    const olderTransition = component.onCatalogLifecycle(component.detail()!);
    const newerTransition = component.onCatalogLifecycle(component.catalogArticles()[1]);
    const archives = http.match((request) => request.method === 'POST' && request.url.endsWith('/archive'));
    expect(archives).toHaveLength(2);

    archives[1].flush({
      ean13: '7351353713578',
      type: 'nonFood',
      name: 'Batterie atelier',
      priceHtCents: 2500,
      isActive: false,
      status: 'archived',
      packaging: 'new',
      priceQuotes: [],
    });
    await fixture.whenStable();
    const reload = http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles');
    reload.flush([
      {
        ean13: '0123456789012',
        type: 'food',
        name: 'Café du Comptoir',
        priceHtCents: 199,
        isActive: true,
        status: 'active',
        dlc: '2026-12-31',
        consumptionModes: ['takeaway'],
      },
    ]);
    await newerTransition;

    archives[0].flush({
      ean13: '0123456789012',
      type: 'food',
      name: 'Café du Comptoir',
      priceHtCents: 199,
      isActive: false,
      status: 'archived',
      dlc: '2026-12-31',
      consumptionModes: ['takeaway'],
      priceQuotes: [],
    });
    await fixture.whenStable();
    const staleDetail = http.expectOne('/api/articles/0123456789012');
    staleDetail.flush({
      ean13: '0123456789012',
      type: 'food',
      name: 'Café du Comptoir',
      priceHtCents: 199,
      isActive: false,
      status: 'archived',
      dlc: '2026-12-31',
      consumptionModes: ['takeaway'],
      priceQuotes: [],
    });
    await fixture.whenStable();
    await fixture.whenStable();
    const staleReload = http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles');
    staleReload.flush([]);
    await olderTransition;
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.lifecycleMessage()).toBe('Batterie atelier est archivé.');
    expect(component.catalogArticles()).toEqual([]);
    expect(component.catalogState()).toBe('empty');
    expect(component.detail()?.status).toBe('archived');
    expect(fixture.nativeElement.querySelector('.article-detail').textContent).toContain('Archivé');
    expect(fixture.nativeElement.querySelector('.article-detail button').textContent).toContain('Réactiver l’Article');
    flushUnusedStockRequest(http);
    http.verify();
  });

  it('réconcilie le détail après un succès obsolète du même EAN', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    const initial = http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles');
    const activeRow = {
      ean13: '0123456789012',
      type: 'food' as const,
      name: 'Café du Comptoir',
      priceHtCents: 199,
      isActive: true,
      status: 'active' as const,
      dlc: '2026-12-31',
      consumptionModes: ['takeaway' as const],
    };
    initial.flush([activeRow]);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.lookupEan.set(activeRow.ean13);
    const detailLookup = component.onLookup(new Event('submit'));
    const detailRequest = http.expectOne(`/api/articles/${activeRow.ean13}`);
    detailRequest.flush({ ...activeRow, priceQuotes: [] });
    await detailLookup;
    fixture.detectChanges();

    const olderTransition = component.onCatalogLifecycle(component.detail()!);
    const newerTransition = component.onCatalogLifecycle({
      ...component.detail()!,
      isActive: false,
      status: 'archived',
    });
    const transitions = http.match((request) => request.method === 'POST' && request.url.includes('/api/articles/'));
    expect(transitions).toHaveLength(2);
    expect(transitions[0].request.url).toContain('/archive');
    expect(transitions[1].request.url).toContain('/reactivate');

    const activeDetail = { ...activeRow, priceQuotes: [] };
    transitions[1].flush(activeDetail);
    await fixture.whenStable();
    const newerReload = http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles');
    newerReload.flush([activeRow]);
    await newerTransition;

    expect(component.detail()?.status).toBe('active');
    expect(component.lifecycleMessage()).toBe('Café du Comptoir est actif.');

    transitions[0].flush({ ...activeRow, isActive: false, status: 'archived', priceQuotes: [] });
    await fixture.whenStable();
    const currentDetail = http.expectOne(`/api/articles/${activeRow.ean13}`);
    fixture.detectChanges();
    expect(component.detail()?.status).toBe('active');
    expect(fixture.nativeElement.querySelector('.article-detail button').textContent).toContain('Archiver l’Article');
    const newerLookup = component.onLookup(new Event('submit'));
    const newerDetail = http.expectOne(`/api/articles/${activeRow.ean13}`);
    newerDetail.flush({ ...activeRow, isActive: false, status: 'archived', priceQuotes: [] });
    await newerLookup;
    fixture.detectChanges();
    expect(component.detail()?.status).toBe('archived');
    currentDetail.flush(activeDetail);
    await fixture.whenStable();
    await fixture.whenStable();
    const staleReload = http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles');
    staleReload.flush([]);
    await olderTransition;
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.detail()?.status).toBe('archived');
    expect(fixture.nativeElement.querySelector('.article-detail').textContent).toContain('Archivé');
    expect(fixture.nativeElement.querySelector('.article-detail button').textContent).toContain('Réactiver l’Article');
    expect(component.lifecycleMessage()).toBe('Café du Comptoir est actif.');
    flushUnusedStockRequest(http);
    http.verify();
  });

  it('shows two server quotes and submits only the editable HT price', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    await fixture.whenStable();
    const component = fixture.componentInstance;
    const initial = foodArticle(1000, 55, 1055, 100, 1100);
    component.lookupEan.set('0123456789012');
    const loaded = component.onLookup(new Event('submit'));
    const lookup = http.expectOne('/api/articles/0123456789012');
    lookup.flush(initial);
    await loaded;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.price-quote')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('#priceTtcCents')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('1055 centimes');
    expect(fixture.nativeElement.textContent).toContain('1100 centimes');

    const price = fixture.nativeElement.querySelector('#detailPriceHtCents') as HTMLInputElement;
    price.value = '199';
    price.dispatchEvent(new Event('input'));
    const submission = component.onPriceUpdate(new Event('submit'));
    const patch = http.expectOne('/api/articles/0123456789012');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ priceHtCents: 199 });
    patch.flush(foodArticle(199, 11, 210, 20, 219));
    await submission;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('210 centimes');
    expect(fixture.nativeElement.textContent).toContain('219 centimes');
    flushUnusedStockRequest(http);
    http.verify();
  });

  it('maps a price update conflict to the HT field and live error region', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component.lookupEan.set('0123456789012');
    const loaded = component.onLookup(new Event('submit'));
    const lookup = http.expectOne('/api/articles/0123456789012');
    lookup.flush(foodArticle(1000, 55, 1055, 100, 1100));
    await loaded;
    fixture.detectChanges();

    const price = fixture.nativeElement.querySelector('#detailPriceHtCents') as HTMLInputElement;
    price.value = '199';
    price.dispatchEvent(new Event('input'));
    const submission = component.onPriceUpdate(new Event('submit'));
    const patch = http.expectOne('/api/articles/0123456789012');
    patch.flush(
      {
        code: 'article.priceHt.conflict',
        title: 'Le Prix HT ne peut pas être modifié.',
        errors: { priceHtCents: ['Prix HT en conflit.'] },
      },
      { status: 409, statusText: 'Conflict' },
    );
    await submission;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#price-update-error').textContent).toContain('Prix HT');
    expect(fixture.nativeElement.querySelector('#priceHt-update-error').textContent).toContain('conflit');
    expect(fixture.nativeElement.querySelector('#detailPriceHtCents')).toBe(document.activeElement);
    flushUnusedStockRequest(http);
    http.verify();
  });

  it('edits food attributes through the PATCH seam and engages the server response', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    const current = foodArticle(1000, 55, 1055, 100, 1100);
    component.lookupEan.set(current.ean13);
    const lookup = component.onLookup(new Event('submit'));
    http.expectOne(`/api/articles/${current.ean13}`).flush(current);
    await lookup;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#attribute-update-form')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#detailDlc')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#detailConsumptionModes')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#detailPackaging')).toBeNull();

    const name = fixture.nativeElement.querySelector('#detailName') as HTMLInputElement;
    name.value = 'Chocolat bio';
    name.dispatchEvent(new Event('input'));
    const dlc = fixture.nativeElement.querySelector('#detailDlc') as HTMLInputElement;
    dlc.value = '2027-01-31';
    dlc.dispatchEvent(new Event('input'));

    const submission = component.onAttributeUpdate(new Event('submit'));
    const patch = http.expectOne(`/api/articles/${current.ean13}`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({
      name: 'Chocolat bio',
      dlc: '2027-01-31',
      consumptionModes: ['takeaway', 'onsite'],
    });
    patch.flush({ ...current, name: 'Chocolat bio', dlc: '2027-01-31' });
    await submission;
    fixture.detectChanges();

    expect(component.detail()?.name).toBe('Chocolat bio');
    expect(fixture.nativeElement.querySelector('#attribute-update-error').textContent).toContain('mis à jour');
    flushUnusedStockRequest(http);
    http.verify();
  });

  it('renders only non-food attribute controls and maps a server field error', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    const current: ArticleResponse = {
      ean13: '7351353713578',
      type: 'nonFood',
      name: 'Batterie',
      priceHtCents: 2500,
      isActive: true,
      status: 'active',
      packaging: 'new',
      priceQuotes: [],
      stock: { physicalQuantity: 0, sellableQuantity: 0 },
    };
    component.lookupEan.set(current.ean13);
    const lookup = component.onLookup(new Event('submit'));
    http.expectOne(`/api/articles/${current.ean13}`).flush(current);
    await lookup;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#detailDlc')).toBeNull();
    expect(fixture.nativeElement.querySelector('#detailConsumptionModes')).toBeNull();
    expect(fixture.nativeElement.querySelector('#detailPackaging')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#detailPriceHtCents')).not.toBeNull();

    const name = fixture.nativeElement.querySelector('#detailName') as HTMLInputElement;
    name.value = '';
    name.dispatchEvent(new Event('input'));
    const submission = component.onAttributeUpdate(new Event('submit'));
    const patch = http.expectOne(`/api/articles/${current.ean13}`);
    patch.flush(
      {
        code: 'article.name.required',
        title: 'La requête est invalide.',
        errors: { name: ['Le nom de l’Article est requis.'] },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await submission;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#detail-name-error').textContent).toContain('requis');
    expect(fixture.nativeElement.querySelector('#detailName')).toBe(document.activeElement);
    flushUnusedStockRequest(http);
    http.verify();
  });

  it('ignores a stale attribute response after navigating to another detail', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    const current = foodArticle(1000, 55, 1055, 100, 1100);
    component.lookupEan.set(current.ean13);
    const currentLookup = component.onLookup(new Event('submit'));
    http.expectOne(`/api/articles/${current.ean13}`).flush(current);
    await currentLookup;
    fixture.detectChanges();

    const update = component.onAttributeUpdate(new Event('submit'));
    const patch = http.expectOne(`/api/articles/${current.ean13}`);
    component.lookupEan.set('7351353713578');
    const newerLookup = component.onLookup(new Event('submit'));
    const newerArticle: ArticleResponse = {
      ean13: '7351353713578',
      type: 'nonFood',
      name: 'Batterie',
      priceHtCents: 2500,
      isActive: true,
      status: 'active',
      packaging: 'new',
      priceQuotes: [],
      stock: { physicalQuantity: 0, sellableQuantity: 0 },
    };
    http.expectOne('/api/articles/7351353713578').flush(newerArticle);
    await newerLookup;
    fixture.detectChanges();

    expect(component.detail()?.ean13).toBe(newerArticle.ean13);
    expect(component.updatingAttributes()).toBe(false);
    patch.flush({ ...current, name: 'Réponse obsolète' });
    await update;
    fixture.detectChanges();

    expect(component.detail()?.ean13).toBe(newerArticle.ean13);
    expect(component.detail()?.name).toBe(newerArticle.name);
    expect(component.attributeUpdateError()).toBe('');
    flushUnusedStockRequest(http);
    http.verify();
  });

  it('loads correctable sources only on request and keeps their opaque ids', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    http.expectOne('/api/stock').flush([]);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    expect(http.match('/api/stock/counter-movements/sources')).toHaveLength(0);
    const loading = component.loadCounterMovementSources();
    const request = http.expectOne('/api/stock/counter-movements/sources');
    request.flush([{
      id: 'server-source-01',
      type: 'SUPPLY',
      timestampUtc: '2030-01-15T09:00:00+00:00',
      ean13: '0123456789012',
      lines: [{ lineNumber: 1, ean13: '0123456789012', stockEffect: 8 }],
    }]);
    await loading;
    fixture.detectChanges();

    expect(component.counterMovementSources()[0].id).toBe('server-source-01');
    expect(fixture.nativeElement.querySelector('#counter-movement-source option[value="server-source-01"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#counter-movement-source-title')).toBeNull();
    http.verify();
  });

  it('renders only the committed counter-movement receipt and preserves zero effects', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/articles').flush([]);
    http.expectOne('/api/stock').flush([]);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.counterMovementSources.set([{
      id: 'server-source-01',
      type: 'SUPPLY',
      timestampUtc: '2030-01-15T09:00:00+00:00',
      ean13: '0123456789012',
      lines: [{ lineNumber: 1, ean13: '0123456789012', stockEffect: 0 }],
    }]);
    component.counterMovementSourcesState.set('ready');
    component.counterMovementModel.set({
      sourceOperationId: 'server-source-01',
      justification: 'Correction vérifiée',
    });

    const submission = component.onCounterMovementSubmit(new Event('submit'));
    const request = http.expectOne('/api/stock/counter-movements');
    expect(request.request.body).toEqual({
      sourceOperationId: 'server-source-01',
      justification: 'Correction vérifiée',
    });
    expect(component.counterMovementReceipt()).toBeNull();
    request.flush({
      counterMovement: {
        id: 'server-counter-01',
        type: 'COUNTER_MOVEMENT',
        timestampUtc: '2030-01-15T10:00:00+00:00',
        sourceOperationId: 'server-source-01',
        sourceOperationType: 'SUPPLY',
        justification: 'Correction vérifiée',
        lines: [{ lineNumber: 1, ean13: '0123456789012', sourceEffect: 0, inverseEffect: 0 }],
      },
      source: {
        id: 'server-source-01',
        type: 'SUPPLY',
        timestampUtc: '2030-01-15T09:00:00+00:00',
        ean13: '0123456789012',
        lines: [{ lineNumber: 1, ean13: '0123456789012', stockEffect: 0 }],
      },
      positions: [{
        ean13: '0123456789012',
        physicalStock: 10,
        sellableStock: 10,
        availability: 'AVAILABLE',
        reason: null,
      }],
    });
    await Promise.resolve();
    http.expectOne('/api/stock').flush([]);
    await submission;
    fixture.detectChanges();

    const result = fixture.nativeElement.querySelector('#counter-movement-result').textContent;
    expect(component.counterMovementReceipt()?.counterMovement.id).toBe('server-counter-01');
    expect(result).toContain('server-source-01');
    expect(result).toContain('server-counter-01');
    expect(result).toContain('Correction vérifiée');
    expect(result).toContain('Effet inverse0');
    expect(result).toContain('10 unités');
    expect(component.counterMovementSourceId()).toBe('');
    http.verify();
  });
});

function foodArticle(
  priceHtCents: number,
  takeawayVatCents: number,
  takeawayTtcCents: number,
  onsiteVatCents: number,
  onsiteTtcCents: number,
): ArticleResponse {
  return {
    ean13: '0123456789012',
    type: 'food',
    name: 'Chocolat noir',
    priceHtCents,
    isActive: true,
    status: 'active',
    dlc: '2026-12-31',
    consumptionModes: ['takeaway', 'onsite'],
    priceQuotes: [
      {
        saleContext: 'takeaway',
        taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
        vatCents: takeawayVatCents,
        priceTtcCents: takeawayTtcCents,
      },
      {
        saleContext: 'onsite',
        taxRate: { code: 'onsite', ratio: '1/10', numerator: 1, denominator: 10 },
        vatCents: onsiteVatCents,
        priceTtcCents: onsiteTtcCents,
      },
    ],
    stock: { physicalQuantity: 0, sellableQuantity: 0 },
  };
}

function flushUnusedStockRequest(http: HttpTestingController): void {
  for (const request of http.match('/api/stock')) {
    request.flush([]);
  }
}
