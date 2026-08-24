import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { LegacyBackofficePage } from './legacy-backoffice-page';
import { DashboardComponent } from './dashboard.component';

describe('LegacyBackofficePage', () => {
  afterEach(() => sessionStorage.clear());

  it('renders immutable sale and counter-movement financial facts in history', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [LegacyBackofficePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(LegacyBackofficePage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    const load = component.loadHistory();
    const request = http.expectOne('/api/history');
    request.flush([
      {
        id: 'sale-1',
        type: 'SALE_STOCK',
        timestampUtc: '2030-01-15T10:00:00Z',
        ean13: '0123456789012',
        articles: [{ ean13: '0123456789012' }],
        quantity: 2,
        lines: [],
        financial: {
          context: 'takeaway',
          unitPriceHtCents: 100,
          taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
          amountHtCents: 200,
          vatCents: 11,
          amountTtcCents: 211,
        },
      },
      {
        id: 'counter-1',
        type: 'COUNTER_MOVEMENT',
        timestampUtc: '2030-01-15T10:01:00Z',
        ean13: '0123456789012',
        articles: [{ ean13: '0123456789012' }],
        quantity: 2,
        lines: [],
        sourceOperationId: 'sale-1',
        justification: 'Correction',
        financialReversal: {
          sourceOperationId: 'sale-1',
          context: 'takeaway',
          unitPriceHtCents: 100,
          taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
          amountHtCents: -200,
          vatCents: -11,
          amountTtcCents: -211,
        },
      },
    ]);
    await load;
    fixture.detectChanges();

    const history = fixture.nativeElement.querySelector('#history-list').textContent;
    expect(history).toContain('Prix HT unitaire historique');
    expect(history).toContain('200 centimes');
    expect(history).toContain('211 centimes');
    expect(history).toContain('-200 centimes');
    expect(history).toContain('-211 centimes');
    expect(history).toContain('Contexte historiqueÀ emporter');
    expect(history).toContain('Taux de TVA historique11/200');
    const historyCounter = fixture.nativeElement.querySelector('[aria-labelledby="history-entry-counter-1"]').textContent as string;
    expect(historyCounter).toContain('Prix HT unitaire historique');
    expect(historyCounter).toContain('100 centimes');

    fixture.detectChanges();
    const articleHistoryLoad = component.loadHistory('0123456789012');
    http.expectOne('/api/history?ean13=0123456789012').flush([{
      id: 'sale-1',
      type: 'SALE_STOCK',
      timestampUtc: '2030-01-15T10:00:00Z',
      ean13: '0123456789012',
      articles: [{ ean13: '0123456789012' }],
      quantity: 2,
      lines: [],
      financial: {
        context: 'takeaway',
        unitPriceHtCents: 100,
        taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
        amountHtCents: 200,
        vatCents: 11,
        amountTtcCents: 211,
      },
    }, {
      id: 'counter-1',
      type: 'COUNTER_MOVEMENT',
      timestampUtc: '2030-01-15T10:01:00Z',
      ean13: '0123456789012',
      articles: [{ ean13: '0123456789012' }],
      lines: [],
      financialReversal: {
        sourceOperationId: 'sale-1',
        context: 'takeaway',
        unitPriceHtCents: 100,
        taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
        amountHtCents: -200,
        vatCents: -11,
        amountTtcCents: -211,
      },
    }]);
    await articleHistoryLoad;
    fixture.detectChanges();
    const articleHistory = fixture.nativeElement.querySelector('#history-list').textContent as string;
    const articleSaleHistory = fixture.nativeElement.querySelector('[aria-labelledby="history-entry-sale-1"]').textContent as string;
    const articleCounterHistory = fixture.nativeElement.querySelector('[aria-labelledby="history-entry-counter-1"]').textContent as string;
    expect(articleSaleHistory).toContain('Contexte historiqueÀ emporter');
    expect(articleCounterHistory).toContain('Prix HT unitaire historique');
    expect(articleCounterHistory).toContain('100 centimes');
    expect(articleHistory).toContain('Contexte historiqueÀ emporter');
    expect(articleHistory).toContain('Taux de TVA historique11/200');
    flushUnusedDashboardRequest(http);
    http.verify();
  });

  it('submits an inventory and renders the server reconciliation receipt', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [LegacyBackofficePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(LegacyBackofficePage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
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
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.inventoryReceipt()?.operation.inventoryDifference).toBe(3);
    expect(fixture.nativeElement.querySelector('#inventory-result').textContent).toContain('+3');
    expect(fixture.nativeElement.querySelector('#inventory-result').textContent).toContain('11');
    await flushUnusedDashboardRequest(http);
    http.verify();
  });

  it('submits several lines to the bulk endpoint and renders every server result', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [LegacyBackofficePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(LegacyBackofficePage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
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
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#inventory-result').textContent).toContain('+3');
    expect(fixture.nativeElement.querySelector('#inventory-result').textContent).toContain('-3');
    expect(fixture.nativeElement.querySelector('#inventory-result').textContent).toContain('Écart d’inventaire0');
    expect(component.inventoryReceipt()?.operation.id).toBe('operation-bulk-1');
    await flushUnusedDashboardRequest(http);
    http.verify();
  });

  it('keeps every bulk line and focuses the first server error after rejection', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [LegacyBackofficePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(LegacyBackofficePage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
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
    await flushUnusedDashboardRequest(http);
    http.verify();
  });

  it('keeps inventory input and maps a server error to the accessible form', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [LegacyBackofficePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(LegacyBackofficePage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
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
    await flushUnusedDashboardRequest(http);
    http.verify();
  });

  it('renders the current Dashboard contract with aligned quantities and alerts', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [LegacyBackofficePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(LegacyBackofficePage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/health').flush({
      status: 'ok',
      provider: 'test',
      warehouseDate: '2030-01-15',
      currentMonth: { from: '2030-01-01', to: '2030-01-31' },
    });
    await fixture.whenStable();
    const dashboard = expectDashboardRequest(http);
    dashboard.flush({
      kpis: { physicalStock: 27, sellableStock: 13, nonSellableStock: 14 },
      alerts: {
        outOfStock: [{
          ean13: '5678901234562',
          name: 'Article actif sans position',
          articleType: 'food',
          lifecycleStatus: 'ACTIVE',
          physicalStock: 0,
          sellableStock: 0,
          nonSellableStock: 0,
          availability: 'OUT_OF_STOCK',
          reason: null,
        }],
        notSellable: [{
          ean13: '2345678901234',
          name: 'Article archivé',
          articleType: 'nonFood',
          lifecycleStatus: 'ARCHIVED',
          physicalStock: 4,
          sellableStock: 0,
          nonSellableStock: 4,
          availability: 'NOT_SELLABLE',
          reason: 'ARCHIVED',
        }],
      },
      stockByArticle: [{
        ean13: '0123456789012',
        name: 'Alimentaire vendable',
        articleType: 'food',
        lifecycleStatus: 'ACTIVE',
        physicalStock: 5,
        sellableStock: 5,
        nonSellableStock: 0,
        availability: 'AVAILABLE',
        reason: null,
      }, {
        ean13: '2345678901234',
        name: 'Article archivé',
        articleType: 'nonFood',
        lifecycleStatus: 'ARCHIVED',
        physicalStock: 4,
        sellableStock: 0,
        nonSellableStock: 4,
        availability: 'NOT_SELLABLE',
          reason: 'ARCHIVED',
        }],
      flowsByDay: [
        { date: '2030-01-01', supplies: 3, sales: 1 },
        { date: '2030-01-02', supplies: 0, sales: 0 },
      ],
      financial: {
        revenueHtCents: 2000,
        revenueTtcCents: 2255,
        vatCollectedCents: 255,
        byTaxRate: [
          { taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 }, amountHtCents: 1000, vatCents: 55, amountTtcCents: 1055 },
          { taxRate: { code: 'onsite', ratio: '1/10', numerator: 1, denominator: 10 }, amountHtCents: 0, vatCents: 0, amountTtcCents: 0 },
          { taxRate: { code: 'nonFood', ratio: '1/5', numerator: 1, denominator: 5 }, amountHtCents: 1000, vatCents: 200, amountTtcCents: 1200 },
        ],
      },
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const dashboardComponent = fixture.debugElement.query(By.directive(DashboardComponent)).componentInstance as DashboardComponent;

    expect(dashboardComponent.dashboardState()).toBe('ready');
    expect(fixture.nativeElement.querySelector('#dashboard-kpi-physical').textContent).toContain('27');
    expect(fixture.nativeElement.querySelector('#dashboard-kpi-sellable').textContent).toContain('13');
    expect(fixture.nativeElement.querySelector('#dashboard-kpi-non-sellable').textContent).toContain('14');
    expect(fixture.nativeElement.querySelector('#dashboard-alert-out-of-stock').textContent)
      .toContain('Article actif sans position');
    expect(fixture.nativeElement.querySelector('#dashboard-alert-not-sellable').textContent)
      .toContain('Article archivé');
    expect(fixture.nativeElement.querySelector('#dashboard-table').textContent)
      .toContain('Stock non vendable');
    expect(fixture.nativeElement.querySelector('#dashboard-table').textContent)
      .toContain('4 unités');
    expect(fixture.nativeElement.querySelector('#dashboard-flows-table').textContent)
      .toContain('2030-01-02');
    expect(fixture.nativeElement.querySelector('#dashboard-flows-table').textContent)
      .toContain('3 unités');
    expect(fixture.nativeElement.querySelector('#dashboard-flows-table').textContent)
      .toContain('1 unité');
    expect(fixture.nativeElement.querySelector('#dashboard-financial-revenue-ht').textContent)
      .toContain('20,00');
    expect(fixture.nativeElement.querySelector('#dashboard-financial-revenue-ttc').textContent)
      .toContain('22,55');
    expect(fixture.nativeElement.querySelector('#dashboard-financial-table tbody').children)
      .toHaveLength(3);
    expect(fixture.nativeElement.querySelector('#dashboard-financial-table').textContent)
      .toContain('5,5 %');
    expect(fixture.nativeElement.querySelector('#dashboard-financial-table').textContent)
      .toContain('20 %');
    http.verify();
  });

  it('announces Dashboard loading, empty and error states and retries the read', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [LegacyBackofficePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(LegacyBackofficePage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    const dashboardComponent = fixture.debugElement.query(By.directive(DashboardComponent)).componentInstance as DashboardComponent;
    http.expectOne('/health').flush({
      status: 'ok',
      provider: 'test',
      warehouseDate: '2030-01-15',
      currentMonth: { from: '2030-01-01', to: '2030-01-31' },
    });
    await fixture.whenStable();
    const initial = expectDashboardRequest(http);
    expect(dashboardComponent.dashboardState()).toBe('loading');
    expect(fixture.nativeElement.querySelector('#dashboard-state').textContent).toContain('Chargement du Dashboard');
    initial.flush({
      kpis: { physicalStock: 0, sellableStock: 0, nonSellableStock: 0 },
      alerts: { outOfStock: [], notSellable: [] },
      stockByArticle: [],
      flowsByDay: [],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(dashboardComponent.dashboardState()).toBe('empty');
    expect(fixture.nativeElement.querySelector('#dashboard-state').textContent).toContain('Aucun Article');

    dashboardComponent.retryDashboard();
    const failed = expectDashboardRequest(http);
    failed.flush({ title: 'Le Dashboard est indisponible.' }, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(dashboardComponent.dashboardState()).toBe('error');
    expect(fixture.nativeElement.querySelector('#dashboard-state [role="alert"]').textContent)
      .toContain('indisponible');
    expect(fixture.nativeElement.querySelector('#dashboard-table')).toBeNull();

    dashboardComponent.retryDashboard();
    const retry = expectDashboardRequest(http);
    retry.flush({
      kpis: { physicalStock: 1, sellableStock: 1, nonSellableStock: 0 },
      alerts: { outOfStock: [], notSellable: [] },
      stockByArticle: [{
        ean13: '0123456789012',
        name: 'Article retrouvé',
        articleType: 'food',
        lifecycleStatus: 'ACTIVE',
        physicalStock: 1,
        sellableStock: 1,
        nonSellableStock: 0,
        availability: 'AVAILABLE',
        reason: null,
      }],
      flowsByDay: [],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(dashboardComponent.dashboardState()).toBe('ready');
    expect(fixture.nativeElement.querySelector('#dashboard-table').textContent).toContain('Article retrouvé');
    http.verify();
  });

  it('uses the warehouse calendar, serializes selected dimensions and keeps them after a server error', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [LegacyBackofficePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(LegacyBackofficePage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/health').flush({
      status: 'ok',
      provider: 'test',
      warehouseDate: '2030-03-15',
      currentMonth: { from: '2030-03-01', to: '2030-03-31' },
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const initial = http.expectOne((request) =>
      request.url === '/api/dashboard'
        && request.params.get('from') === '2030-03-01'
        && request.params.get('to') === '2030-03-31');
    expect((fixture.nativeElement.querySelector('#dashboard-from') as HTMLInputElement).value).toBe('2030-03-01');
    expect((fixture.nativeElement.querySelector('#dashboard-to') as HTMLInputElement).value).toBe('2030-03-31');
    initial.flush({
      kpis: { physicalStock: 0, sellableStock: 0, nonSellableStock: 0 },
      alerts: { outOfStock: [], notSellable: [] },
      stockByArticle: [],
      flowsByDay: [],
    });
    await fixture.whenStable();

    const setValue = (selector: string, value: string) => {
      const control = fixture.nativeElement.querySelector(selector) as HTMLInputElement | HTMLSelectElement;
      control.value = value;
      control.dispatchEvent(new Event('change'));
    };
    setValue('#dashboard-from', '2030-03-05');
    setValue('#dashboard-to', '2030-03-10');
    setValue('#dashboard-type', 'food');
    setValue('#dashboard-mode', 'onsite');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('#dashboard-submit') as HTMLButtonElement).click();

    const filtered = http.expectOne((request) =>
      request.url === '/api/dashboard'
        && request.params.get('from') === '2030-03-05'
        && request.params.get('to') === '2030-03-10'
        && request.params.get('type') === 'food'
        && request.params.get('mode') === 'onsite'
        && request.params.get('packaging') === null);
    filtered.flush(
      {
        title: 'La période est invalide.',
        code: 'dashboard.reversed_period',
        errors: { from: ['La date de début est invalide.'], to: ['La date de fin est invalide.'] },
      },
      { status: 400, statusText: 'Bad Request' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#dashboard-state [role="alert"]').textContent)
      .toContain('période est invalide');
    expect((fixture.nativeElement.querySelector('#dashboard-from') as HTMLInputElement).value).toBe('2030-03-05');
    expect((fixture.nativeElement.querySelector('#dashboard-to') as HTMLInputElement).value).toBe('2030-03-10');
    expect((fixture.nativeElement.querySelector('#dashboard-type') as HTMLSelectElement).value).toBe('food');
    expect((fixture.nativeElement.querySelector('#dashboard-mode') as HTMLSelectElement).value).toBe('onsite');
    expect((fixture.nativeElement.querySelector('#dashboard-packaging') as HTMLSelectElement).disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('#dashboard-from-error').textContent)
      .toContain('date de début est invalide');
    http.verify();
  });

  it('keeps non-applicable dimensions as an AND filter instead of silently neutralizing them', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [LegacyBackofficePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(LegacyBackofficePage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/health').flush({
      status: 'ok',
      provider: 'test',
      warehouseDate: '2030-03-15',
      currentMonth: { from: '2030-03-01', to: '2030-03-31' },
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const initial = http.expectOne((request) =>
      request.url === '/api/dashboard'
        && request.params.get('from') === '2030-03-01'
        && request.params.get('to') === '2030-03-31');
    initial.flush({
      kpis: { physicalStock: 0, sellableStock: 0, nonSellableStock: 0 },
      alerts: { outOfStock: [], notSellable: [] },
      stockByArticle: [],
      flowsByDay: [],
      financial: null,
    });
    await fixture.whenStable();

    const setValue = (selector: string, value: string) => {
      const control = fixture.nativeElement.querySelector(selector) as HTMLSelectElement;
      control.value = value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setValue('#dashboard-packaging', 'new');
    setValue('#dashboard-type', 'food');
    setValue('#dashboard-mode', 'onsite');
    fixture.detectChanges();

    const packaging = fixture.nativeElement.querySelector('#dashboard-packaging') as HTMLSelectElement;
    expect(packaging.value).toBe('new');
    expect(packaging.disabled).toBe(false);

    (fixture.nativeElement.querySelector('#dashboard-submit') as HTMLButtonElement).click();
    const filtered = http.expectOne((request) =>
      request.url === '/api/dashboard'
        && request.params.get('type') === 'food'
        && request.params.get('mode') === 'onsite'
        && request.params.get('packaging') === 'new');
    filtered.flush({
      kpis: { physicalStock: 0, sellableStock: 0, nonSellableStock: 0 },
      alerts: { outOfStock: [], notSellable: [] },
      stockByArticle: [],
      flowsByDay: [],
      financial: null,
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#dashboard-state').textContent).toContain('Aucun Article');
    http.verify();
  });

  it('keeps the newest Dashboard response when reads complete out of order', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [LegacyBackofficePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(LegacyBackofficePage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/health').flush({
      status: 'ok',
      provider: 'test',
      warehouseDate: '2030-03-15',
      currentMonth: { from: '2030-03-01', to: '2030-03-31' },
    });
    await fixture.whenStable();

    const initial = http.expectOne((request) => request.url === '/api/dashboard');
    initial.flush({
      kpis: { physicalStock: 0, sellableStock: 0, nonSellableStock: 0 },
      alerts: { outOfStock: [], notSellable: [] },
      stockByArticle: [],
      flowsByDay: [],
    });
    await fixture.whenStable();

    const form = fixture.nativeElement.querySelector('#dashboard-filters') as HTMLFormElement;
    const setControl = (id: string, value: string) => {
      const control = fixture.nativeElement.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement;
      control.value = value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setControl('dashboard-type', 'food');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    setControl('dashboard-type', 'nonFood');
    setControl('dashboard-packaging', 'new');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const [older, newer] = http.match((request) => request.url === '/api/dashboard');
    expect(older.request.params.get('type')).toBe('food');
    expect(newer.request.params.get('type')).toBe('nonFood');
    newer.flush({
      kpis: { physicalStock: 8, sellableStock: 8, nonSellableStock: 0 },
      alerts: { outOfStock: [], notSellable: [] },
      stockByArticle: [{
        ean13: '4567890123456',
        name: 'Article le plus récent',
        articleType: 'nonFood',
        lifecycleStatus: 'ACTIVE',
        physicalStock: 8,
        sellableStock: 8,
        nonSellableStock: 0,
        availability: 'AVAILABLE',
        reason: null,
      }],
      flowsByDay: [],
    });
    await fixture.whenStable();
    older.flush({
      kpis: { physicalStock: 5, sellableStock: 5, nonSellableStock: 0 },
      alerts: { outOfStock: [], notSellable: [] },
      stockByArticle: [{
        ean13: '0123456789012',
        name: 'Réponse ancienne',
        articleType: 'food',
        lifecycleStatus: 'ACTIVE',
        physicalStock: 5,
        sellableStock: 5,
        nonSellableStock: 0,
        availability: 'AVAILABLE',
        reason: null,
      }],
      flowsByDay: [],
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#dashboard-table').textContent)
      .toContain('Article le plus récent');
    expect(fixture.nativeElement.querySelector('#dashboard-table').textContent)
      .not.toContain('Réponse ancienne');
    http.verify();
  });

  it('associates Dashboard validation errors with keyboard-accessible controls and announcements', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [LegacyBackofficePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(LegacyBackofficePage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/health').flush({
      status: 'ok',
      provider: 'test',
      warehouseDate: '2030-03-15',
      currentMonth: { from: '2030-03-01', to: '2030-03-31' },
    });
    await fixture.whenStable();
    const initial = http.expectOne((request) =>
      request.url === '/api/dashboard'
        && request.params.get('from') === '2030-03-01'
        && request.params.get('to') === '2030-03-31');
    initial.flush({
      kpis: { physicalStock: 0, sellableStock: 0, nonSellableStock: 0 },
      alerts: { outOfStock: [], notSellable: [] },
      stockByArticle: [],
      flowsByDay: [],
    });
    await fixture.whenStable();
    fixture.detectChanges();

    for (const id of ['dashboard-from', 'dashboard-to', 'dashboard-type', 'dashboard-mode', 'dashboard-packaging']) {
      expect(fixture.nativeElement.querySelector(`label[for="${id}"]`)).not.toBeNull();
    }
    const state = fixture.nativeElement.querySelector('#dashboard-state');
    expect(state.getAttribute('role')).toBe('status');
    expect(state.getAttribute('aria-live')).toBe('polite');

    const fromControl = fixture.nativeElement.querySelector('#dashboard-from') as HTMLInputElement;
    fromControl.value = '';
    fromControl.dispatchEvent(new Event('change'));
    (fixture.nativeElement.querySelector('#dashboard-filters') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    const from = fixture.nativeElement.querySelector('#dashboard-from') as HTMLInputElement;
    expect(from.getAttribute('aria-invalid')).toBe('true');
    expect(from.getAttribute('aria-describedby')).toBe('dashboard-from-error');
    expect(fixture.nativeElement.querySelector('#dashboard-from-error')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#dashboard-state [role="alert"]')).not.toBeNull();
    expect(from).toBe(document.activeElement);
    http.verify();
  });

  it('keeps Dashboard controls visible when the calendar bootstrap fails', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [LegacyBackofficePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(LegacyBackofficePage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/health').flush(
      { title: 'Persistence unavailable' },
      { status: 503, statusText: 'Service Unavailable' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#dashboard-state [role="alert"]').textContent)
      .toContain('Persistence unavailable');
    expect(fixture.nativeElement.querySelector('#dashboard-filters')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#dashboard-from')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#dashboard-to')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.dashboard-calendar-note').textContent)
      .toContain('indisponible');
    http.verify();
  });

  it('loads correctable sources only on request and keeps their opaque ids', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [LegacyBackofficePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(LegacyBackofficePage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
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
    await flushUnusedDashboardRequest(http);
    http.verify();
  });

  it('renders only the committed counter-movement receipt and preserves zero effects', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [LegacyBackofficePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(LegacyBackofficePage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
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
    await flushUnusedDashboardRequest(http);
    http.verify();
  });

  it('renders the historical sale snapshot and the signed committed reversal', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [LegacyBackofficePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(LegacyBackofficePage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.counterMovementSources.set([{
      id: 'sale-source-01',
      type: 'SALE',
      timestampUtc: '2030-01-15T09:00:00+00:00',
      ean13: '0123456789012',
      lines: [{ lineNumber: 1, ean13: '0123456789012', stockEffect: -3 }],
      financial: {
        context: 'takeaway',
        unitPriceHtCents: 1000,
        taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
        amountHtCents: 3000,
        vatCents: 165,
        amountTtcCents: 3165,
      },
    }]);
    component.counterMovementSourcesState.set('ready');
    component.counterMovementModel.set({
      sourceOperationId: 'sale-source-01',
      justification: 'Correction Vente historique',
    });
    fixture.detectChanges();
    const source = fixture.nativeElement.querySelector('#counter-movement-source-title').parentElement.textContent;
    expect(source).toContain('1000 centimes');
    expect(source).toContain('3000 centimes');

    const submission = component.onCounterMovementSubmit(new Event('submit'));
    const request = http.expectOne('/api/stock/counter-movements');
    request.flush({
      counterMovement: {
        id: 'counter-sale-01',
        type: 'COUNTER_MOVEMENT',
        timestampUtc: '2030-01-15T10:00:00+00:00',
        sourceOperationId: 'sale-source-01',
        sourceOperationType: 'SALE',
        justification: 'Correction Vente historique',
        lines: [{ lineNumber: 1, ean13: '0123456789012', sourceEffect: -3, inverseEffect: 3 }],
      },
      source: {
        id: 'sale-source-01',
        type: 'SALE',
        timestampUtc: '2030-01-15T09:00:00+00:00',
        ean13: '0123456789012',
        lines: [{ lineNumber: 1, ean13: '0123456789012', stockEffect: -3 }],
        financial: {
          context: 'takeaway',
          unitPriceHtCents: 1000,
          taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
          amountHtCents: 3000,
          vatCents: 165,
          amountTtcCents: 3165,
        },
      },
      financialReversal: {
        sourceOperationId: 'sale-source-01',
        context: 'takeaway',
        unitPriceHtCents: 1000,
        taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
        amountHtCents: -3000,
        vatCents: -165,
        amountTtcCents: -3165,
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
    await submission;
    fixture.detectChanges();

    const result = fixture.nativeElement.querySelector('#counter-movement-result').textContent;
    expect(result).toContain('-3000 centimes');
    expect(result).toContain('-165 centimes');
    expect(result).toContain('-3165 centimes');
    await flushUnusedDashboardRequest(http);
    http.verify();
  });

  it('renders literal positive, negative and zero Inventory fields and lifecycle changes', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [LegacyBackofficePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(LegacyBackofficePage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.historyFilterEan.set('0123456789012');
    const historyPromise = component.loadHistory();
    const request = http.expectOne((candidate) =>
      candidate.method === 'GET' && candidate.urlWithParams === '/api/history?ean13=0123456789012');
    request.flush([
      {
        id: 'inventory-positive-01',
        type: 'INVENTORY',
        timestampUtc: '2030-01-15T10:00:00Z',
        ean13: '0123456789012',
        articles: [{ ean13: '0123456789012' }],
        countedQuantity: 12,
        difference: 2,
        resultingPhysicalStock: 12,
        lines: [{ lineNumber: 1, ean13: '0123456789012', countedQuantity: 12, difference: 2, resultingPhysicalStock: 12 }],
      },
      {
        id: 'inventory-negative-01',
        type: 'INVENTORY',
        timestampUtc: '2030-01-15T10:01:00Z',
        ean13: '0123456789012',
        articles: [{ ean13: '0123456789012' }],
        countedQuantity: 7,
        difference: -3,
        resultingPhysicalStock: 7,
        lines: [{ lineNumber: 1, ean13: '0123456789012', countedQuantity: 7, difference: -3, resultingPhysicalStock: 7 }],
      },
      {
        id: 'inventory-zero-01',
        type: 'INVENTORY',
        timestampUtc: '2030-01-15T10:02:00Z',
        ean13: '0123456789012',
        articles: [{ ean13: '0123456789012' }],
        countedQuantity: 5,
        difference: 0,
        resultingPhysicalStock: 5,
        lines: [{ lineNumber: 1, ean13: '0123456789012', countedQuantity: 5, difference: 0, resultingPhysicalStock: 5 }],
      },
      {
        id: 'dlc-change-01',
        type: 'CATALOG_DLC_CHANGE',
        timestampUtc: '2030-01-15T11:00:00Z',
        ean13: '0123456789012',
        articles: [{ ean13: '0123456789012' }],
        changes: [{ field: 'dlc', before: '2030-01-15', after: '2030-01-20' }],
        lines: [],
      },
    ]);
    await historyPromise;
    fixture.detectChanges();

    expect(component.historyState()).toBe('ready');
    expect(fixture.nativeElement.querySelector('#history-state').textContent).toContain('4 faits trouvés');
    const historyText = fixture.nativeElement.querySelector('#history-list').textContent as string;
    expect(historyText).toContain('0123456789012');
    expect(historyText).toContain('12 unités');
    expect(historyText).toContain('Écart+2');
    expect(historyText).toContain('7 unités');
    expect(historyText).toContain('Écart-3');
    expect(historyText).toContain('Écart0');
    expect(historyText).toContain('2030-01-15');
    expect(historyText).toContain('2030-01-20');

    const article = foodArticle(1000, 55, 1055, 100, 1100);
    fixture.detectChanges();
    const articleHistoryPromise = component.loadHistory(article.ean13);
    const articleHistoryRequest = http.expectOne('/api/history?ean13=0123456789012');
    articleHistoryRequest.flush([
      {
        id: 'inventory-positive-01',
        type: 'INVENTORY',
        timestampUtc: '2030-01-15T10:00:00Z',
        ean13: article.ean13,
        articles: [{ ean13: article.ean13 }],
        countedQuantity: 12,
        difference: 2,
        resultingPhysicalStock: 12,
        lines: [{ lineNumber: 1, ean13: article.ean13, countedQuantity: 12, difference: 2, resultingPhysicalStock: 12 }],
      },
      {
        id: 'inventory-negative-01',
        type: 'INVENTORY',
        timestampUtc: '2030-01-15T10:01:00Z',
        ean13: article.ean13,
        articles: [{ ean13: article.ean13 }],
        countedQuantity: 7,
        difference: -3,
        resultingPhysicalStock: 7,
        lines: [{ lineNumber: 1, ean13: article.ean13, countedQuantity: 7, difference: -3, resultingPhysicalStock: 7 }],
      },
      {
        id: 'inventory-zero-01',
        type: 'INVENTORY',
        timestampUtc: '2030-01-15T10:02:00Z',
        ean13: article.ean13,
        articles: [{ ean13: article.ean13 }],
        countedQuantity: 5,
        difference: 0,
        resultingPhysicalStock: 5,
        lines: [{ lineNumber: 1, ean13: article.ean13, countedQuantity: 5, difference: 0, resultingPhysicalStock: 5 }],
      },
      {
        id: 'dlc-change-01',
        type: 'CATALOG_DLC_CHANGE',
        timestampUtc: '2030-01-15T11:00:00Z',
        ean13: article.ean13,
        articles: [{ ean13: article.ean13 }],
        changes: [{ field: 'dlc', before: '2030-01-15', after: '2030-01-20' }],
        lines: [],
      },
      {
        id: 'archive-01',
        type: 'CATALOG_ARCHIVE',
        timestampUtc: '2030-01-15T12:00:00Z',
        ean13: article.ean13,
        articles: [{ ean13: article.ean13 }],
        lines: [],
        previousStatus: 'active',
        nextStatus: 'archived',
      },
    ]);
    await articleHistoryPromise;
    fixture.detectChanges();

    expect(component.historyState()).toBe('ready');
    const articleHistoryText = fixture.nativeElement.querySelector('#history-list').textContent as string;
    expect(articleHistoryText).toContain('Quantité comptée');
    expect(articleHistoryText).toContain('12');
    expect(articleHistoryText).toContain('+2');
    expect(articleHistoryText).toContain('7');
    expect(articleHistoryText).toContain('-3');
    expect(articleHistoryText).toContain('Écart0');
    expect(articleHistoryText).toContain('2030-01-15');
    expect(articleHistoryText).toContain('2030-01-20');
    expect(articleHistoryText).toContain('Archivage Catalogue');
    expect(articleHistoryText).toContain('active');
    expect(articleHistoryText).toContain('archived');
    flushUnusedDashboardRequest(http);
    http.verify();
  });

  it('returns from a filtered history to global and renders server inverse effects', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [LegacyBackofficePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(LegacyBackofficePage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.historyFilterEan.set('0123456789012');
    const filtered = component.loadHistory();
    http.expectOne('/api/history?ean13=0123456789012').flush([{
      id: 'counter-01',
      type: 'COUNTER_MOVEMENT',
      timestampUtc: '2030-01-15T10:00:00Z',
      ean13: '0123456789012',
      articles: [{ ean13: '0123456789012' }],
      previousPhysicalStock: 0,
      lines: [
        { lineNumber: 1, ean13: '0123456789012', previousPhysicalStock: 0, inverseEffect: -3 },
        { lineNumber: 2, ean13: '0123456789012', previousPhysicalStock: 0, inverseEffect: 4 },
        { lineNumber: 3, ean13: '0123456789012', previousPhysicalStock: 0, inverseEffect: 0 },
      ],
      sourceOperationId: 'source-01',
      sourceOperationType: 'SUPPLY',
      justification: 'Correction',
      correctionOperationId: 'counter-01',
    }]);
    await filtered;
    fixture.detectChanges();

    const global = component.historyFilterEan();
    expect(global).toBe('0123456789012');
    const globalRequestPromise = new Promise<void>((resolve) => {
      const button = fixture.nativeElement.querySelector('#history-filter-form .secondary-button') as HTMLButtonElement;
      button.addEventListener('click', () => resolve(), { once: true });
      button.click();
    });
    await globalRequestPromise;
    const request = http.expectOne('/api/history');
    request.flush([{
      id: 'bulk-01',
      type: 'SUPPLY',
      timestampUtc: '2030-01-15T08:00:00Z',
      ean13: '',
      articles: [{ ean13: '0123456789012' }, { ean13: '7351353713578' }],
      lines: [
        { lineNumber: 1, ean13: '0123456789012', quantity: 2, stockEffect: 2, resultingPhysicalStock: 5 },
        { lineNumber: 2, ean13: '7351353713578', quantity: 3, stockEffect: 3, resultingPhysicalStock: 4 },
      ],
    }, {
      id: 'supply-02',
      type: 'SUPPLY',
      timestampUtc: '2030-01-15T09:00:00Z',
      ean13: '7351353713578',
      articles: [{ ean13: '7351353713578' }],
      quantity: 2,
      stockEffect: 2,
      resultingPhysicalStock: 2,
      lines: [],
    }, {
      id: 'counter-01',
      type: 'COUNTER_MOVEMENT',
      timestampUtc: '2030-01-15T10:00:00Z',
      ean13: '0123456789012',
      articles: [{ ean13: '0123456789012' }],
      previousPhysicalStock: 0,
      lines: [
        { lineNumber: 1, ean13: '0123456789012', previousPhysicalStock: 0, inverseEffect: -3 },
        { lineNumber: 2, ean13: '0123456789012', previousPhysicalStock: 0, inverseEffect: 4 },
        { lineNumber: 3, ean13: '0123456789012', previousPhysicalStock: 0, inverseEffect: 0 },
      ],
      sourceOperationId: 'source-01',
      sourceOperationType: 'SUPPLY',
      justification: 'Correction',
      correctionOperationId: 'counter-01',
    }]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.historyFilterEan()).toBe('');
    const globalText = fixture.nativeElement.querySelector('#history-list').textContent as string;
    const bulkText = fixture.nativeElement.querySelector('[aria-labelledby="history-entry-bulk-01"]').textContent as string;
    expect(bulkText).toContain('0123456789012');
    expect(bulkText).toContain('2 unités');
    expect(bulkText).toContain('effet +2');
    expect(bulkText).toContain('résultat 5');
    expect(bulkText).toContain('7351353713578');
    expect(bulkText).toContain('3 unités');
    expect(bulkText).toContain('effet +3');
    expect(bulkText).toContain('résultat 4');
    expect(bulkText).not.toContain('Quantité utile');
    expect(bulkText).not.toContain('Stock physique résultant');
    expect(globalText).toContain('7351353713578');
    expect(globalText).toContain('effet inverse -3');
    expect(globalText).toContain('effet inverse +4');
    expect(globalText).toContain('effet inverse 0');
    const globalCounterText = fixture.nativeElement.querySelector('[aria-labelledby="history-entry-counter-01"]').textContent as string;
    expect(globalCounterText).not.toContain('Stock physique précédent');
    expect(globalCounterText).not.toContain('précédent');

    const article = foodArticle(1000, 55, 1055, 100, 1100);
    const articleHistory = component.loadHistory(article.ean13);
    http.expectOne('/api/history?ean13=0123456789012').flush([{
      id: 'bulk-01',
      type: 'SUPPLY',
      timestampUtc: '2030-01-15T08:00:00Z',
      ean13: article.ean13,
      articles: [{ ean13: article.ean13 }],
      lines: [
        { lineNumber: 1, ean13: article.ean13, quantity: 2, stockEffect: 2, resultingPhysicalStock: 5 },
      ],
    }, {
      id: 'source-01',
      type: 'SUPPLY',
      timestampUtc: '2030-01-15T09:00:00Z',
      ean13: article.ean13,
      articles: [{ ean13: article.ean13 }],
      quantity: 3,
      stockEffect: 3,
      resultingPhysicalStock: 3,
      correctedByOperationId: 'counter-01',
      lines: [],
    }, {
      id: 'counter-01',
      type: 'COUNTER_MOVEMENT',
      timestampUtc: '2030-01-15T10:00:00Z',
      ean13: article.ean13,
      articles: [{ ean13: article.ean13 }],
      previousPhysicalStock: 0,
      lines: [
        { lineNumber: 1, ean13: article.ean13, previousPhysicalStock: 0, inverseEffect: -3 },
        { lineNumber: 2, ean13: article.ean13, previousPhysicalStock: 0, inverseEffect: 4 },
        { lineNumber: 3, ean13: article.ean13, previousPhysicalStock: 0, inverseEffect: 0 },
      ],
      sourceOperationId: 'source-01',
      sourceOperationType: 'SUPPLY',
      justification: 'Correction',
      correctionOperationId: 'counter-01',
    }]);
    await articleHistory;
    fixture.detectChanges();

    const articleText = fixture.nativeElement.querySelector('#history-list').textContent as string;
    expect(articleText).toContain('2 unités');
    expect(articleText).toContain('effet +2');
    expect(articleText).toContain('résultat 5');
    expect(articleText).toContain('Correctioncounter-01');
    expect(articleText).toContain('Corrigé parcounter-01');
    expect(articleText).toContain('effet inverse -3');
    expect(articleText).toContain('effet inverse +4');
    expect(articleText).toContain('effet inverse 0');
    const articleCounterText = fixture.nativeElement.querySelector('[aria-labelledby="history-entry-counter-01"]').textContent as string;
    expect(articleCounterText).not.toContain('précédent');
    flushUnusedDashboardRequest(http);
    http.verify();
  });

  it('announces loading, empty and error states for global history', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [LegacyBackofficePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(LegacyBackofficePage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    const loading = component.loadHistory();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#history-state').textContent).toContain('Chargement');

    http.expectOne('/api/history').flush([]);
    await loading;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#history-state').textContent).toContain('Aucun fait');

    const error = component.loadHistory();
    http.expectOne('/api/history').flush(
      { title: 'Historique indisponible', code: 'HISTORY_READ_FAILURE' },
      { status: 500, statusText: 'Server Error' },
    );
    await error;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#history-state').textContent).toContain('Historique indisponible');
    flushUnusedDashboardRequest(http);
    http.verify();
  });
});

function foodArticle(
  priceHtCents: number,
  takeawayVatCents: number,
  takeawayTtcCents: number,
  onsiteVatCents: number,
  onsiteTtcCents: number,
) {
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

function expectDashboardRequest(http: HttpTestingController) {
  return http.expectOne((request) =>
    request.method === 'GET'
      && request.url === '/api/dashboard'
      && request.params.get('from') === '2030-01-01'
      && request.params.get('to') === '2030-01-31');
}

async function flushUnusedDashboardRequest(http: HttpTestingController): Promise<void> {
  for (const request of http.match('/health')) {
    request.flush({
      status: 'ok',
      provider: 'test',
      warehouseDate: '2030-01-15',
      currentMonth: { from: '2030-01-01', to: '2030-01-31' },
    });
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    await Promise.resolve();
  }
  for (const request of http.match((request) => request.url === '/api/dashboard')) {
    request.flush({
      kpis: { physicalStock: 0, sellableStock: 0, nonSellableStock: 0 },
      alerts: { outOfStock: [], notSellable: [] },
      stockByArticle: [],
      flowsByDay: [],
    });
  }
}
