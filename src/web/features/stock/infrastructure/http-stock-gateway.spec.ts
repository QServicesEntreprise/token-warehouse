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
      blockedQuantity: 0,
      availability: 'available',
      blockReason: null,
    }]);
  });

  it('keeps the Problem Details title for an accessible error', async () => {
    const result = firstValueFrom(gateway.getByEan13('0123456789012'));
    http.expectOne('/api/stock/0123456789012').flush(
      { title: 'Le détail du Stock est indisponible.' },
      { status: 500, statusText: 'Server Error' },
    );

    await expect(result).rejects.toThrow('Le détail du Stock est indisponible.');
  });
});
