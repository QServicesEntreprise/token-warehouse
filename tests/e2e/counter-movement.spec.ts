import { expect } from '@playwright/test';
import { test } from './fixtures';
import { leadingZeroEan13 } from './helpers/ean13';
import { waitForRequest } from './helpers/http';

const canonicalEan = leadingZeroEan13;
const archivedEan = '2345678901234';
const apiBaseUrl = 'http://127.0.0.1:5100';

type CounterReceipt = {
  counterMovement: {
    id: string;
    sourceOperationId: string;
    justification: string;
    lines: { ean13: string; sourceEffect: number; inverseEffect: number }[];
  };
  financialReversal?: {
    sourceOperationId: string;
    context: string | null;
    unitPriceHtCents: number;
    amountHtCents: number;
    vatCents: number;
    amountTtcCents: number;
  };
  positions: { ean13: string; physicalStock: number; sellableStock: number; reason: string | null }[];
};

const openCounterMovement = async (page: import('@playwright/test').Page) => {
  await page.getByRole('link', { name: 'Contre-mouvement' }).click();
  const sourcesResponsePromise = waitForRequest(page, 'GET', '/api/stock/counter-movements/sources');
  await page.locator('#counter-movement-load').click();
  const sourcesResponse = await sourcesResponsePromise;
  expect(sourcesResponse.status()).toBe(200);
  return page.locator('#counter-movement-source');
};

const correctSource = async (
  page: import('@playwright/test').Page,
  sourceId: string,
  justification: string,
) => {
  const sourceSelect = page.locator('#counter-movement-source');
  await sourceSelect.selectOption(sourceId);
  await page.locator('#counter-movement-justification').fill(justification);
  const counterResponsePromise = waitForRequest(page, 'POST', '/api/stock/counter-movements');
  await page.locator('#counter-movement-submit').click();
  return counterResponsePromise;
};

test('corrects a committed supply through the real Stock journey', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#stock-table').getByRole('row', { name: /Alimentaire aux deux modes/ })).toContainText('5 unités');

  const supplyResponsePromise = waitForRequest(page, 'POST', '/api/supplies');
  await page.locator('#supplyEan13').fill(canonicalEan);
  await page.locator('#supplyQuantity').fill('2');
  await page.locator('#supply-form button[type="submit"]').click();
  const supplyResponse = await supplyResponsePromise;
  expect(supplyResponse.status()).toBe(201);
  const supplyReceipt = await supplyResponse.json() as { operation: { id: string } };
  await expect(page.locator('#supply-status')).toContainText('enregistré');

  const sourceSelect = await openCounterMovement(page);
  expect(await sourceSelect.locator('option').count()).toBe(2);
  const sourceId = supplyReceipt.operation.id;
  await sourceSelect.selectOption(sourceId);

  let counterPostCount = 0;
  const counterRequestListener = (request: import('@playwright/test').Request) => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname === '/api/stock/counter-movements') {
      counterPostCount += 1;
    }
  };
  page.on('request', counterRequestListener);
  await page.locator('#counter-movement-submit').click();
  await expect(page.locator('#counter-movement-justification-error')).toContainText('obligatoire');
  await expect(page.locator('#counter-movement-justification')).toBeFocused();
  page.off('request', counterRequestListener);
  expect(counterPostCount).toBe(0);

  const counterResponse = await correctSource(page, sourceId, 'Correction après contrôle');
  expect(counterResponse.status()).toBe(201);
  expect(counterResponse.headers()['content-type']).toContain('application/json');
  const receipt = await counterResponse.json() as CounterReceipt;
  expect(receipt.counterMovement.sourceOperationId).toBe(sourceId);
  expect(receipt.counterMovement.justification).toBe('Correction après contrôle');
  expect(receipt.counterMovement.lines[0]?.sourceEffect).toBe(2);
  expect(receipt.counterMovement.lines[0]?.inverseEffect).toBe(-2);
  expect(receipt.positions[0]?.physicalStock).toBe(5);

  const result = page.locator('#counter-movement-result');
  await expect(result).toBeVisible();
  await expect(result).toBeFocused();
  await expect(result).toContainText(sourceId);
  await expect(result).toContainText('Correction après contrôle');
  await expect(result).toContainText('Effet inverse-2');
  await expect(result).toContainText('5 unités');
  await expect(sourceSelect.locator(`option[value="${sourceId}"]`)).toHaveCount(0);

  const retry = await page.request.post(`${apiBaseUrl}/api/stock/counter-movements`, {
    data: { sourceOperationId: sourceId, justification: 'Second essai' },
  });
  expect(retry.status()).toBe(409);
  await expect(retry.json()).resolves.toMatchObject({ code: 'SOURCE_ALREADY_CORRECTED' });
});

test('corrects a Sale from its historical snapshot after the Article price and lifecycle change', async ({ page }) => {
  const salePanel = page.locator('#sale-panel');
  await page.goto('/');
  await salePanel.locator('#sale-search').fill(canonicalEan);
  await salePanel.locator('#sale-search-form').getByRole('button', { name: 'Rechercher un Article', exact: true }).click();
  const saleRow = salePanel.getByRole('row', { name: new RegExp(leadingZeroEan13) });
  await saleRow.getByRole('button', { name: 'Sélectionner Alimentaire aux deux modes' }).click();
  await salePanel.getByLabel('À emporter', { exact: true }).check();
  await salePanel.locator('#sale-quantity').fill('1');
  const saleResponsePromise = waitForRequest(page, 'POST', '/api/sales');
  await salePanel.locator('#sale-submit').click();
  const saleResponse = await saleResponsePromise;
  expect(saleResponse.status()).toBe(201);
  const sale = await saleResponse.json() as {
    operation: { id: string };
    financial: { unitPriceHtCents: number; amountHtCents: number; vatCents: number; amountTtcCents: number };
  };
  expect(sale.financial).toMatchObject({ unitPriceHtCents: 100, amountHtCents: 100, vatCents: 6, amountTtcCents: 106 });

  const priceResponse = await page.request.patch(`${apiBaseUrl}/api/articles/${canonicalEan}`, {
    data: { priceHtCents: 250 },
  });
  expect(priceResponse.status()).toBe(200);
  const archiveResponse = await page.request.post(`${apiBaseUrl}/api/articles/${canonicalEan}/archive`);
  expect(archiveResponse.status()).toBe(200);

  const sourceSelect = await openCounterMovement(page);
  await sourceSelect.selectOption(sale.operation.id);
  await expect(page.locator('#counter-movement-source-title').locator('xpath=..')).toContainText('100 centimes');
  await expect(page.locator('#counter-movement-source-title').locator('xpath=..')).toContainText('106 centimes');

  const counterResponse = await correctSource(page, sale.operation.id, 'Correction financière historique');
  expect(counterResponse.status()).toBe(201);
  const receipt = await counterResponse.json() as CounterReceipt;
  expect(receipt.financialReversal).toMatchObject({
    sourceOperationId: sale.operation.id,
    unitPriceHtCents: 100,
    amountHtCents: -100,
    vatCents: -6,
    amountTtcCents: -106,
  });
  expect(receipt.positions[0]).toMatchObject({ physicalStock: 5, sellableStock: 0, reason: 'ARCHIVED' });
  await expect(page.locator('#counter-movement-result')).toContainText('-106 centimes');
  await expect(page.locator('#counter-movement-result')).toContainText('Article archivé');

  await page.reload();
  const saleRead = await page.request.get(`${apiBaseUrl}/api/sales/${sale.operation.id}`);
  expect(saleRead.status()).toBe(200);
  await expect(saleRead.json()).resolves.toMatchObject({
    financial: { unitPriceHtCents: 100, amountHtCents: 100, vatCents: 6, amountTtcCents: 106 },
  });
  const historyRead = await page.request.get(`${apiBaseUrl}/api/history?ean13=${canonicalEan}`);
  expect(historyRead.status()).toBe(200);
  const history = await historyRead.json() as Array<{ type: string; financialReversal?: { amountHtCents: number; vatCents: number; amountTtcCents: number } }>;
  expect(history.find((entry) => entry.type === 'COUNTER_MOVEMENT')?.financialReversal).toMatchObject({
    amountHtCents: -100,
    vatCents: -6,
    amountTtcCents: -106,
  });
});

test('corrects an inventory after a later movement and keeps the source unchanged', async ({ page }) => {
  await page.goto('/');
  await page.locator('#inventory-ean13').fill(canonicalEan);
  await page.locator('#inventory-countedQuantity').fill('11');
  const inventoryResponsePromise = waitForRequest(page, 'POST', '/api/inventories');
  await page.locator('#inventory-form button[type="submit"]').click();
  const inventoryResponse = await inventoryResponsePromise;
  expect(inventoryResponse.status()).toBe(201);
  const inventoryReceipt = await inventoryResponse.json() as {
    operation: { id: string; previousPhysicalStock: number; countedQuantity: number; inventoryDifference: number };
  };
  const inventoryId = inventoryReceipt.operation.id;
  expect(inventoryReceipt.operation).toMatchObject({ previousPhysicalStock: 5, countedQuantity: 11, inventoryDifference: 6 });

  const supplyResponsePromise = waitForRequest(page, 'POST', '/api/supplies');
  await page.locator('#supplyEan13').fill(canonicalEan);
  await page.locator('#supplyQuantity').fill('2');
  await page.locator('#supply-form button[type="submit"]').click();
  expect((await supplyResponsePromise).status()).toBe(201);

  await openCounterMovement(page);
  const counterResponse = await correctSource(page, inventoryId, 'Correction après mouvement ultérieur');
  expect(counterResponse.status()).toBe(201);
  const receipt = await counterResponse.json() as CounterReceipt;
  expect(receipt.counterMovement.lines[0]?.inverseEffect).toBe(-6);
  expect(receipt.positions[0]?.physicalStock).toBe(7);

  const sourceResponse = await page.request.get(`${apiBaseUrl}/api/inventories/${inventoryId}`);
  expect(sourceResponse.status()).toBe(200);
  await expect(sourceResponse.json()).resolves.toMatchObject({
    id: inventoryId,
    previousPhysicalStock: 5,
    countedQuantity: 11,
    inventoryDifference: 6,
  });
  await page.reload();
  await expect(page.locator('#stock-table').getByRole('row', { name: /Alimentaire aux deux modes/ })).toContainText('7 unités');
});

test('corrects every line of a bulk supply as one visible counter-movement', async ({ page }) => {
  await page.goto('/');
  await page.locator('#supplyEan13').fill(canonicalEan);
  await page.locator('#supplyQuantity').fill('2');
  await page.locator('#supply-form button[type="button"]').click();
  await page.locator('#supplyEan13-1').fill('4567890123456');
  await page.locator('#supplyQuantity-1').fill('1');
  const supplyResponsePromise = waitForRequest(page, 'POST', '/api/supplies/bulk');
  await page.locator('#supply-form button[type="submit"]').click();
  const supplyResponse = await supplyResponsePromise;
  expect(supplyResponse.status()).toBe(201);
  const supplyReceipt = await supplyResponse.json() as {
    operation: { id: string; lines: { ean13: string; quantity: number }[] };
  };
  const sourceId = supplyReceipt.operation.id;
  expect(supplyReceipt.operation.lines).toHaveLength(2);

  await openCounterMovement(page);
  const counterResponse = await correctSource(page, sourceId, 'Correction du lot');
  expect(counterResponse.status()).toBe(201);
  const receipt = await counterResponse.json() as CounterReceipt;
  expect(receipt.counterMovement.sourceOperationId).toBe(sourceId);
  expect(receipt.counterMovement.lines.map((line) => line.inverseEffect)).toEqual([-2, -1]);
  expect(receipt.positions).toHaveLength(2);
  await expect(page.locator('#counter-movement-result .inventory-result-line')).toHaveCount(2);
});

test('rejects a bulk counter-movement atomically when one line would go negative', async ({ page }) => {
  await page.goto('/');
  await page.locator('#supplyEan13').fill(canonicalEan);
  await page.locator('#supplyQuantity').fill('2');
  await page.locator('#supply-form button[type="button"]').click();
  await page.locator('#supplyEan13-1').fill('4567890123456');
  await page.locator('#supplyQuantity-1').fill('1');
  const supplyResponsePromise = waitForRequest(page, 'POST', '/api/supplies/bulk');
  await page.locator('#supply-form button[type="submit"]').click();
  const supplyResponse = await supplyResponsePromise;
  expect(supplyResponse.status()).toBe(201);
  const supplyReceipt = await supplyResponse.json() as { operation: { id: string } };

  await page.locator('#inventory-ean13').fill(canonicalEan);
  await page.locator('#inventory-countedQuantity').fill('1');
  const inventoryResponsePromise = waitForRequest(page, 'POST', '/api/inventories');
  await page.locator('#inventory-form button[type="submit"]').click();
  expect((await inventoryResponsePromise).status()).toBe(201);

  const sourceSelect = await openCounterMovement(page);
  const counterResponse = await correctSource(page, supplyReceipt.operation.id, 'Lot impossible');
  expect(counterResponse.status()).toBe(409);
  await expect(counterResponse.json()).resolves.toMatchObject({ code: 'RESULTING_STOCK_NEGATIVE' });
  await expect(page.locator('#counter-movement-error')).toContainText('conflit');
  await expect(sourceSelect).toHaveValue(supplyReceipt.operation.id);
  await expect(page.locator('#counter-movement-justification')).toHaveValue('Lot impossible');
  await expect(page.locator('#counter-movement-result')).toHaveCount(0);

  const canonicalStock = await page.request.get(`${apiBaseUrl}/api/stock/${canonicalEan}`);
  const secondStock = await page.request.get(`${apiBaseUrl}/api/stock/4567890123456`);
  await expect(canonicalStock.json()).resolves.toMatchObject({ physicalQuantity: 1 });
  await expect(secondStock.json()).resolves.toMatchObject({ physicalQuantity: 9 });
});

test('corrects an archived Article while keeping its sellable stock at zero', async ({ page }) => {
  await page.goto('/');
  await page.locator('#inventory-ean13').fill(archivedEan);
  await page.locator('#inventory-countedQuantity').fill('6');
  const inventoryResponsePromise = waitForRequest(page, 'POST', '/api/inventories');
  await page.locator('#inventory-form button[type="submit"]').click();
  const inventoryResponse = await inventoryResponsePromise;
  expect(inventoryResponse.status()).toBe(201);
  const inventoryReceipt = await inventoryResponse.json() as { operation: { id: string } };

  await openCounterMovement(page);
  const counterResponse = await correctSource(page, inventoryReceipt.operation.id, 'Correction du résiduel archivé');
  expect(counterResponse.status()).toBe(201);
  const receipt = await counterResponse.json() as CounterReceipt;
  expect(receipt.counterMovement.lines[0]?.inverseEffect).toBe(-2);
  expect(receipt.positions[0]).toMatchObject({ physicalStock: 4, sellableStock: 0, reason: 'ARCHIVED' });
  await expect(page.locator('#counter-movement-result')).toContainText('Article archivé');
});
