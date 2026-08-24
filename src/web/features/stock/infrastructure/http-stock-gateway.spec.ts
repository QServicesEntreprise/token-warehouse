import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpStockGateway } from './http-stock-gateway';

describe('HttpStockGateway', () => {
  let gateway: HttpStockGateway;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [HttpStockGateway, provideHttpClient(), provideHttpClientTesting()],
    });
    gateway = TestBed.inject(HttpStockGateway);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('returns Stock models from the positions endpoint', async () => {
    const result = firstValueFrom(gateway.list());
    http.expectOne('/api/stock').flush([{
      ean13: '0123456789012',
      name: 'Article disponible',
      type: 'nonFood',
      isActive: true,
      status: 'active',
      physicalQuantity: 4,
      sellableQuantity: 4,
      availability: 'AVAILABLE',
      reason: null,
      packaging: 'new',
    }]);

    await expect(result).resolves.toEqual([{
      ean13: '0123456789012',
      name: 'Article disponible',
      physicalQuantity: 4,
      sellableQuantity: 4,
      nonSellableQuantity: 0,
      availability: 'available',
      nonSellableReason: null,
    }]);
  });

  it('keeps the Problem Details title for an accessible error', async () => {
    const result = firstValueFrom(gateway.getByEan13('0123456789012'));
    http.expectOne('/api/stock/0123456789012').flush(
      { title: 'Le détail du Stock est indisponible.', code: 'STOCK_UNAVAILABLE' },
      { status: 500, statusText: 'Server Error' },
    );

    await expect(result).rejects.toEqual({
      code: 'STOCK_UNAVAILABLE',
      fieldErrors: {},
      status: 500,
      title: 'Le détail du Stock est indisponible.',
    });
  });

  it('records a unit Approvisionnement through its dedicated contract', async () => {
    const result = firstValueFrom(gateway.recordSupply({ ean13: '0123456789012', quantity: 3 }));
    const request = http.expectOne('/api/supplies');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ ean13: '0123456789012', quantity: 3 });
    request.flush({
      operation: {
        id: 'supply-1', type: 'supply', ean13: '0123456789012', quantity: 3,
        occurredAt: '2030-01-15T10:00:00Z',
      },
      position: {
        ean13: '0123456789012', name: 'Article reçu', type: 'food', isActive: true, status: 'active',
        physicalQuantity: 11, sellableQuantity: 11, availability: 'AVAILABLE', reason: null,
      },
    });

    await expect(result).resolves.toMatchObject({
      operation: { id: 'supply-1', lines: [{ ean13: '0123456789012', quantity: 3 }] },
      positions: [{ physicalQuantity: 11, sellableQuantity: 11 }],
    });
  });

  it('records one bulk Approvisionnement request and returns every committed result', async () => {
    const lines = [
      { ean13: '0123456789012', quantity: 3 },
      { ean13: '5901234123457', quantity: 2 },
    ];
    const result = firstValueFrom(gateway.recordBulkSupply({ lines }));
    const request = http.expectOne('/api/supplies/bulk');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ lines });
    request.flush({
      operation: {
        id: 'bulk-1', type: 'supply', occurredAt: '2030-01-15T10:00:00Z',
        lines: lines.map((line, index) => ({ lineNumber: index + 1, ...line })),
      },
      positions: lines.map((line) => ({
        ean13: line.ean13, name: line.ean13, type: 'food', isActive: true, status: 'active',
        physicalQuantity: line.quantity, sellableQuantity: line.quantity, availability: 'AVAILABLE', reason: null,
      })),
    });

    await expect(result).resolves.toMatchObject({
      operation: { id: 'bulk-1', lines },
      positions: [{ physicalQuantity: 3 }, { physicalQuantity: 2 }],
    });
  });

  it('provides correctable sources through the Stock gateway', async () => {
    const result = firstValueFrom(gateway.listCorrectableSources());
    http.expectOne('/api/stock/counter-movements/sources').flush([{
      id: 'supply-01',
      type: 'SUPPLY',
      timestampUtc: '2030-01-15T09:00:00Z',
      ean13: '0123456789012',
      lines: [{ lineNumber: 1, ean13: '0123456789012', stockEffect: 2 }],
    }]);

    await expect(result).resolves.toEqual([{
      id: 'supply-01',
      type: 'SUPPLY',
      timestampUtc: '2030-01-15T09:00:00Z',
      ean13: '0123456789012',
      lines: [{ lineNumber: 1, ean13: '0123456789012', stockEffect: 2 }],
      financial: undefined,
    }]);
  });

  it('records a Counter-movement command and returns the committed server result', async () => {
    const result = firstValueFrom(gateway.recordCounterMovement({
      sourceOperationId: 'supply-01',
      justification: 'Erreur de saisie',
    }));
    const request = http.expectOne('/api/stock/counter-movements');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      sourceOperationId: 'supply-01',
      justification: 'Erreur de saisie',
    });
    request.flush({
      counterMovement: {
        id: 'counter-01',
        type: 'COUNTER_MOVEMENT',
        timestampUtc: '2030-01-15T10:00:00Z',
        sourceOperationId: 'supply-01',
        sourceOperationType: 'SUPPLY',
        justification: 'Erreur de saisie',
        lines: [{ lineNumber: 1, ean13: '0123456789012', sourceEffect: 2, inverseEffect: -2 }],
      },
      source: {
        id: 'supply-01',
        type: 'SUPPLY',
        timestampUtc: '2030-01-15T09:00:00Z',
        ean13: '0123456789012',
        lines: [{ lineNumber: 1, ean13: '0123456789012', stockEffect: 2 }],
      },
      positions: [{
        ean13: '0123456789012',
        physicalStock: 5,
        sellableStock: 5,
        availability: 'AVAILABLE',
        reason: null,
      }],
    });

    await expect(result).resolves.toMatchObject({
      counterMovement: { id: 'counter-01', sourceOperationId: 'supply-01' },
      positions: [{ physicalQuantity: 5, sellableQuantity: 5 }],
    });
  });
});
