import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { LegacyBackofficePage } from './legacy-backoffice-page';

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
