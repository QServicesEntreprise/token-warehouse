import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { LegacyBackofficePage } from './legacy-backoffice-page';

describe('LegacyBackofficePage', () => {
  afterEach(() => sessionStorage.clear());

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
