import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { AppComponent } from './app.component';
import { ArticleResponse } from './article-api.service';

describe('AppComponent', () => {
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
