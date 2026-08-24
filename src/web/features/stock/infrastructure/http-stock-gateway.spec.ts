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

  it('records an Inventory and maps the committed server receipt', async () => {
    const result = firstValueFrom(gateway.recordInventory({
      ean13: '0123456789012',
      countedQuantity: 11,
    }));
    const request = http.expectOne('/api/inventories');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ ean13: '0123456789012', countedQuantity: 11 });
    request.flush({
      operation: {
        id: 'inventory-1',
        type: 'INVENTORY',
        ean13: '0123456789012',
        previousPhysicalStock: 5,
        countedQuantity: 11,
        inventoryDifference: 6,
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

    await expect(result).resolves.toMatchObject({ id: 'inventory-1', lines: [{ inventoryDifference: 6 }] });
  });

  it('records an atomic bulk Inventory through the bulk endpoint', async () => {
    const commands = [
      { ean13: '0123456789012', countedQuantity: 11 },
      { ean13: '7351353713578', countedQuantity: 2 },
    ];
    const result = firstValueFrom(gateway.recordBulkInventory(commands));
    const request = http.expectOne('/api/inventories/bulk');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ lines: commands });
    request.flush({
      operation: {
        id: 'inventory-bulk-1',
        type: 'INVENTORY',
        timestampUtc: '2030-01-15T10:00:00+00:00',
        lines: [{
          lineNumber: 1,
          ean13: '0123456789012',
          countedQuantity: 11,
          previousPhysicalStock: 5,
          inventoryDifference: 6,
          resultingPhysicalStock: 11,
          position: { ean13: '0123456789012', physicalStock: 11, sellableStock: 11, availability: 'AVAILABLE', reason: null },
        }, {
          lineNumber: 2,
          ean13: '7351353713578',
          countedQuantity: 2,
          previousPhysicalStock: 5,
          inventoryDifference: -3,
          resultingPhysicalStock: 2,
          position: { ean13: '7351353713578', physicalStock: 2, sellableStock: 2, availability: 'AVAILABLE', reason: null },
        }],
      },
    });

    await expect(result).resolves.toMatchObject({ id: 'inventory-bulk-1', lines: [{ lineNumber: 1 }, { lineNumber: 2 }] });
  });

  it('restores an Inventory with server Stock positions', async () => {
    const result = firstValueFrom(gateway.getInventoryById('inventory-1'));
    http.expectOne('/api/inventories/inventory-1').flush({
      id: 'inventory-1',
      type: 'INVENTORY',
      ean13: '0123456789012',
      previousPhysicalStock: 5,
      countedQuantity: 11,
      inventoryDifference: 6,
      resultingPhysicalStock: 11,
      timestampUtc: '2030-01-15T10:00:00+00:00',
    });
    http.expectOne('/api/stock/0123456789012').flush({
      ean13: '0123456789012',
      name: 'Article inventorié',
      type: 'food',
      isActive: true,
      status: 'active',
      physicalQuantity: 11,
      sellableQuantity: 11,
      availability: 'AVAILABLE',
      reason: null,
      dlc: '2030-01-16',
      consumptionModes: ['takeaway'],
    });

    await expect(result).resolves.toMatchObject({ id: 'inventory-1', lines: [{ position: { physicalQuantity: 11 } }] });
  });
});
