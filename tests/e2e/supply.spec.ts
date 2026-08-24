import { expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import type { HistoryEntryResponse } from '../../src/web/app/history-api.service';
import type { StockPositionResponse } from '../../src/web/app/stock-api.service';
import { apiUrl as apiBaseUrl, test } from './fixtures';
import { expectProblemDetails, waitForRequest } from './helpers/http';
import { supply } from './helpers/state';

const activeEan13 = '4567890123456';
const secondActiveEan13 = '5678901234562';
const expiredEan13 = '1234567890128';
const archivedEan13 = '2345678901234';
const unsellableEan13 = '3456789012340';
const unknownEan13 = '4006381333931';

const stockRow = (page: Page, ean13: string) => page
  .locator('#stock-table')
  .getByRole('row', { name: new RegExp(ean13) });

const readStock = async (page: Page, ean13: string): Promise<StockPositionResponse> => {
  const response = await page.request.get(`${apiBaseUrl}/api/stock/${ean13}`);
  expect(response.status()).toBe(200);
  return response.json() as Promise<StockPositionResponse>;
};

test('records a unit Approvisionnement and returns the committed Stock physique and Stock vendable', async ({ page }) => {
  const supplyPanel = page.locator('#supply-panel');
  await page.goto('/stock/approvisionnements');
  await expect(supplyPanel.getByRole('heading', { name: 'Enregistrer un Approvisionnement' })).toBeVisible();
  await expect(stockRow(page, activeEan13)).toContainText('8 unités');

  await supplyPanel.locator('#supplyEan13').fill(activeEan13);
  await supplyPanel.locator('#supplyQuantity').fill('5');
  const responsePromise = waitForRequest(page, 'POST', '/api/supplies');
  await supplyPanel.getByRole('button', { name: 'Enregistrer l’Approvisionnement' }).click();
  const response = await responsePromise;

  expect(response.status()).toBe(201);
  const body = await response.json() as {
    operation: { id: string; occurredAt: string };
    position: StockPositionResponse;
  };
  expect(body.operation.id).toMatch(/\S+/);
  expect(body.operation.occurredAt).toBe('2030-01-15T10:00:00+00:00');
  expect(body.position).toMatchObject({
    ean13: activeEan13,
    physicalQuantity: 13,
    sellableQuantity: 13,
    availability: 'AVAILABLE',
    reason: null,
  });
  await expect(supplyPanel.locator('#supply-status')).toContainText(
    `Approvisionnement ${body.operation.id} enregistré le ${body.operation.occurredAt}.`,
  );
  await expect(supplyPanel.locator('#supply-status')).toBeFocused();
  await expect(stockRow(page, activeEan13)).toContainText('13 unités');
  await expect(stockRow(page, activeEan13)).toContainText('Disponible');
});

test('keeps a committed unit Approvisionnement after a full reload', async ({ page }) => {
  const supplyPanel = page.locator('#supply-panel');
  await page.goto('/stock/approvisionnements');
  await supplyPanel.locator('#supplyEan13').fill(activeEan13);
  await supplyPanel.locator('#supplyQuantity').fill('5');
  const responsePromise = waitForRequest(page, 'POST', '/api/supplies');
  await supplyPanel.getByRole('button', { name: 'Enregistrer l’Approvisionnement' }).click();
  expect((await responsePromise).status()).toBe(201);

  const reloadStockResponsePromise = waitForRequest(page, 'GET', '/api/stock');
  await page.reload();
  expect((await reloadStockResponsePromise).status()).toBe(200);
  await expect(stockRow(page, activeEan13)).toContainText('13 unités');
  await expect(stockRow(page, activeEan13)).toContainText('Disponible');
  await expect(readStock(page, activeEan13)).resolves.toMatchObject({
    physicalQuantity: 13,
    sellableQuantity: 13,
  });
});

test('persists Stock physique that remains non vendable by policy', async ({ page }) => {
  const supplyPanel = page.locator('#supply-panel');
  await page.goto('/stock/approvisionnements');

  await supplyPanel.locator('#supplyEan13').fill(expiredEan13);
  await supplyPanel.locator('#supplyQuantity').fill('2');
  const expiredResponsePromise = waitForRequest(page, 'POST', '/api/supplies');
  await supplyPanel.getByRole('button', { name: 'Enregistrer l’Approvisionnement' }).click();
  const expiredResponse = await expiredResponsePromise;
  expect(expiredResponse.status()).toBe(201);
  expect(await expiredResponse.json()).toMatchObject({
    operation: { type: 'supply', ean13: expiredEan13, quantity: 2 },
    position: {
      ean13: expiredEan13,
      physicalQuantity: 9,
      sellableQuantity: 0,
      availability: 'NOT_SELLABLE',
      reason: 'DLC_EXPIRED',
    },
  });
  await expect(stockRow(page, expiredEan13)).toContainText('9 unités');
  await expect(stockRow(page, expiredEan13)).toContainText('0 unités');
  await expect(stockRow(page, expiredEan13)).toContainText('DLC dépassée');

  await supplyPanel.locator('#supplyEan13').fill(unsellableEan13);
  await supplyPanel.locator('#supplyQuantity').fill('2');
  const unsellableResponsePromise = waitForRequest(page, 'POST', '/api/supplies');
  await supplyPanel.getByRole('button', { name: 'Enregistrer l’Approvisionnement' }).click();
  const unsellableResponse = await unsellableResponsePromise;
  expect(unsellableResponse.status()).toBe(201);
  expect(await unsellableResponse.json()).toMatchObject({
    operation: { type: 'supply', ean13: unsellableEan13, quantity: 2 },
    position: {
      ean13: unsellableEan13,
      physicalQuantity: 5,
      sellableQuantity: 0,
      availability: 'NOT_SELLABLE',
      reason: 'UNSELLABLE_PACKAGING',
    },
  });
  await expect(stockRow(page, unsellableEan13)).toContainText('5 unités');
  await expect(stockRow(page, unsellableEan13)).toContainText('0 unités');
  await expect(stockRow(page, unsellableEan13)).toContainText('Packaging invendable');

  const reloadStockResponsePromise = waitForRequest(page, 'GET', '/api/stock');
  await page.reload();
  const reloadStockResponse = await reloadStockResponsePromise;
  expect(reloadStockResponse.status()).toBe(200);
  expect(await reloadStockResponse.json()).toEqual(expect.arrayContaining([
    expect.objectContaining({
      ean13: expiredEan13,
      physicalQuantity: 9,
      sellableQuantity: 0,
      reason: 'DLC_EXPIRED',
    }),
    expect.objectContaining({
      ean13: unsellableEan13,
      physicalQuantity: 5,
      sellableQuantity: 0,
      reason: 'UNSELLABLE_PACKAGING',
    }),
  ]));
  await expect(stockRow(page, expiredEan13)).toContainText('9 unités');
  await expect(stockRow(page, expiredEan13)).toContainText('DLC dépassée');
  await expect(stockRow(page, unsellableEan13)).toContainText('5 unités');
  await expect(stockRow(page, unsellableEan13)).toContainText('Packaging invendable');
});

test('shows a pending Approvisionnement and keeps committed Stock after a server failure', async ({ page }) => {
  await supply(page, activeEan13, 5);
  const supplyPanel = page.locator('#supply-panel');
  await page.goto('/stock/approvisionnements');
  await expect(stockRow(page, activeEan13)).toContainText('13 unités');

  let releaseDelayedSupply!: () => void;
  const delayedSupply = new Promise<void>((resolve) => {
    releaseDelayedSupply = resolve;
  });
  const supplyRoute = /\/api\/supplies$/;
  const delayedSupplyRoute = async (route: Route) => {
    await delayedSupply;
    await route.continue();
  };
  await page.route(supplyRoute, delayedSupplyRoute);

  await supplyPanel.locator('#supplyEan13').fill(activeEan13);
  await supplyPanel.locator('#supplyQuantity').fill('1');
  const delayedRequestPromise = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return request.method() === 'POST' && url.pathname === '/api/supplies';
  });
  const delayedResponsePromise = waitForRequest(page, 'POST', '/api/supplies');
  await supplyPanel.locator('#supplyQuantity').press('Enter');
  await delayedRequestPromise;
  await expect(stockRow(page, activeEan13)).toContainText('13 unités');
  await expect(stockRow(page, activeEan13)).not.toContainText('14 unités');
  await expect(supplyPanel.locator('#supplyQuantity')).toHaveValue('1');
  await expect(supplyPanel.getByRole('button', { name: 'Réception…' })).toBeDisabled();
  releaseDelayedSupply();
  expect((await delayedResponsePromise).status()).toBe(201);
  await expect(stockRow(page, activeEan13)).toContainText('14 unités');
  await expect(supplyPanel.locator('#supply-status')).toContainText('Approvisionnement');
  await expect(supplyPanel.locator('#supply-status')).toBeFocused();
  await page.unroute(supplyRoute, delayedSupplyRoute);

  await page.route(supplyRoute, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/problem+json',
      body: JSON.stringify({ title: 'Une erreur interne est survenue.', code: 'internal_error' }),
    });
  });
  await supplyPanel.locator('#supplyEan13').fill(activeEan13);
  await supplyPanel.locator('#supplyQuantity').fill('1');
  const failureResponsePromise = waitForRequest(page, 'POST', '/api/supplies');
  await supplyPanel.getByRole('button', { name: 'Enregistrer l’Approvisionnement' }).click();
  const failureResponse = await failureResponsePromise;
  expect(failureResponse.status()).toBe(500);
  expect(failureResponse.headers()['content-type']).toContain('application/problem+json');
  await expect(supplyPanel.locator('#supply-status')).toContainText('erreur interne');
  await expect(supplyPanel.locator('#supply-status')).toBeFocused();
  await expect(supplyPanel.locator('#supplyQuantity')).toHaveValue('1');
  await expect(readStock(page, activeEan13)).resolves.toMatchObject({
    physicalQuantity: 14,
    sellableQuantity: 14,
  });
  await page.unroute(supplyRoute);
  await page.screenshot({ path: 'artifacts/playwright/supply.png', fullPage: true });
});

for (const invalid of [
  { label: 'zero', value: '0', fieldError: /strictement positif/ },
  { label: 'negative', value: '-1', fieldError: /\S+/ },
  { label: 'non-integer', value: '1.5', fieldError: /\S+/ },
]) {
  test(`rejects a ${invalid.label} Approvisionnement quantity without moving Stock`, async ({ page }) => {
    const supplyPanel = page.locator('#supply-panel');
    await page.goto('/stock/approvisionnements');
    await supplyPanel.locator('#supplyEan13').fill(activeEan13);
    await supplyPanel.locator('#supplyQuantity').fill(invalid.value);
    const responsePromise = waitForRequest(page, 'POST', '/api/supplies');
    await supplyPanel.locator('#supplyQuantity').press('Enter');
    const response = await responsePromise;

    await expectProblemDetails(response, {
      status: 400,
      code: 'supply.validation',
      fields: ['quantity'],
    });
    await expect(supplyPanel.locator('#supply-status')).toContainText('invalide');
    await expect(supplyPanel.locator('#supply-quantity-error')).toHaveText(invalid.fieldError);
    await expect(supplyPanel.locator('#supplyEan13')).toHaveValue(activeEan13);
    await expect(supplyPanel.locator('#supplyQuantity')).toHaveValue(invalid.value);
    await expect(supplyPanel.locator('#supplyQuantity')).toBeFocused();
    await expect(readStock(page, activeEan13)).resolves.toMatchObject({
      physicalQuantity: 8,
      sellableQuantity: 8,
    });
  });
}

test('rejects an unknown Article with 404 and creates no Stock position', async ({ page }) => {
  const before = await page.request.get(`${apiBaseUrl}/api/stock/${unknownEan13}`);
  expect(before.status()).toBe(404);

  const supplyPanel = page.locator('#supply-panel');
  await page.goto('/stock/approvisionnements');
  await supplyPanel.locator('#supplyEan13').fill(unknownEan13);
  await supplyPanel.locator('#supplyQuantity').fill('2');
  const responsePromise = waitForRequest(page, 'POST', '/api/supplies');
  await supplyPanel.getByRole('button', { name: 'Enregistrer l’Approvisionnement' }).click();
  const response = await responsePromise;

  await expectProblemDetails(response, { status: 404, code: 'supply.article.not_found' });
  await expect(supplyPanel.locator('#supply-status')).toContainText('introuvable');
  await expect(supplyPanel.locator('#supply-status')).toBeFocused();
  await expect(supplyPanel.locator('#supplyEan13')).toHaveValue(unknownEan13);
  await expect(supplyPanel.locator('#supplyQuantity')).toHaveValue('2');
  const after = await page.request.get(`${apiBaseUrl}/api/stock/${unknownEan13}`);
  expect(after.status()).toBe(404);
});

test('rejects an archived Article with a targeted error and unchanged Stock physique', async ({ page }) => {
  await expect(readStock(page, archivedEan13)).resolves.toMatchObject({
    physicalQuantity: 4,
    sellableQuantity: 0,
  });

  const supplyPanel = page.locator('#supply-panel');
  await page.goto('/stock/approvisionnements');
  await supplyPanel.locator('#supplyEan13').fill(archivedEan13);
  await supplyPanel.locator('#supplyQuantity').fill('2');
  const responsePromise = waitForRequest(page, 'POST', '/api/supplies');
  await supplyPanel.getByRole('button', { name: 'Enregistrer l’Approvisionnement' }).click();
  const response = await responsePromise;

  await expectProblemDetails(response, {
    status: 409,
    code: 'article_archived',
    fields: ['ean13'],
  });
  await expect(supplyPanel.locator('#supply-status')).toContainText('archivé');
  await expect(supplyPanel.locator('#supplyEan13')).toBeFocused();
  await expect(supplyPanel.locator('#supplyEan13')).toHaveValue(archivedEan13);
  await expect(supplyPanel.locator('#supplyQuantity')).toHaveValue('2');
  await expect(readStock(page, archivedEan13)).resolves.toMatchObject({
    physicalQuantity: 4,
    sellableQuantity: 0,
  });
});

test('records one ordered Opération en masse and exposes the same order in Historique', async ({ page }) => {
  const supplyPanel = page.locator('#supply-panel');
  await page.goto('/stock/approvisionnements');
  await expect(stockRow(page, activeEan13)).toContainText('8 unités');
  await supplyPanel.locator('#supplyEan13').fill(activeEan13);
  await supplyPanel.locator('#supplyQuantity').fill('3');
  await supplyPanel.getByRole('button', { name: 'Ajouter une ligne' }).click();
  await supplyPanel.locator('#supplyEan13-1').fill(secondActiveEan13);
  await supplyPanel.locator('#supplyQuantity-1').fill('5');

  const historyBeforeResponse = await page.request.get(`${apiBaseUrl}/api/history`);
  expect(historyBeforeResponse.status()).toBe(200);
  const historyBefore = await historyBeforeResponse.json() as HistoryEntryResponse[];

  const responsePromise = waitForRequest(page, 'POST', '/api/supplies/bulk');
  await supplyPanel.getByRole('button', { name: 'Enregistrer l’Approvisionnement' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  expect(response.headers()['content-type']).toContain('application/json');
  const body = await response.json() as {
    operation: {
      id: string;
      lines: Array<{ lineNumber: number; ean13: string; quantity: number }>;
    };
    positions: StockPositionResponse[];
  };
  expect(body.operation.lines).toEqual([
    { lineNumber: 1, ean13: activeEan13, quantity: 3 },
    { lineNumber: 2, ean13: secondActiveEan13, quantity: 5 },
  ]);
  expect(body.positions).toEqual(expect.arrayContaining([
    expect.objectContaining({ ean13: activeEan13, physicalQuantity: 11, sellableQuantity: 11 }),
    expect.objectContaining({ ean13: secondActiveEan13, physicalQuantity: 5, sellableQuantity: 5 }),
  ]));
  await expect(stockRow(page, activeEan13)).toContainText('11 unités');
  await expect(stockRow(page, secondActiveEan13)).toContainText('5 unités');

  const historyResponse = await page.request.get(`${apiBaseUrl}/api/history`);
  expect(historyResponse.status()).toBe(200);
  const history = await historyResponse.json() as HistoryEntryResponse[];
  expect(history).toHaveLength(historyBefore.length + 1);
  expect(history.filter((entry) => entry.id === body.operation.id)).toHaveLength(1);
  expect(history.find((entry) => entry.id === body.operation.id)).toMatchObject({
    type: 'SUPPLY',
    lines: [
      {
        lineNumber: 1,
        ean13: activeEan13,
        quantity: 3,
        stockEffect: 3,
        resultingPhysicalStock: 11,
      },
      {
        lineNumber: 2,
        ean13: secondActiveEan13,
        quantity: 5,
        stockEffect: 5,
        resultingPhysicalStock: 5,
      },
    ],
  });

  await page.reload();
  await expect(stockRow(page, activeEan13)).toContainText('11 unités');
  await expect(stockRow(page, secondActiveEan13)).toContainText('5 unités');
});

test('keeps every Opération en masse draft and all Stock unchanged when one Article is unknown', async ({ page }) => {
  const supplyPanel = page.locator('#supply-panel');
  await page.goto('/stock/approvisionnements');
  await supplyPanel.locator('#supplyEan13').fill(activeEan13);
  await supplyPanel.locator('#supplyQuantity').fill('3');
  await supplyPanel.getByRole('button', { name: 'Ajouter une ligne' }).click();
  await supplyPanel.locator('#supplyEan13-1').fill(unknownEan13);
  await supplyPanel.locator('#supplyQuantity-1').fill('5');
  const responsePromise = waitForRequest(page, 'POST', '/api/supplies/bulk');
  await supplyPanel.locator('#supplyQuantity-1').press('Enter');
  const response = await responsePromise;

  await expectProblemDetails(response, {
    status: 404,
    code: 'bulk_supply.article.not_found',
    fields: ['lines[1].ean13'],
  });
  await expect(supplyPanel.locator('#supplyEan13')).toHaveValue(activeEan13);
  await expect(supplyPanel.locator('#supplyQuantity')).toHaveValue('3');
  await expect(supplyPanel.locator('#supplyEan13-1')).toHaveValue(unknownEan13);
  await expect(supplyPanel.locator('#supplyQuantity-1')).toHaveValue('5');
  await expect(supplyPanel.locator('#supply-status')).toContainText('introuvable');
  await expect(readStock(page, activeEan13)).resolves.toMatchObject({
    physicalQuantity: 8,
    sellableQuantity: 8,
  });
  expect((await page.request.get(`${apiBaseUrl}/api/stock/${unknownEan13}`)).status()).toBe(404);

  await supplyPanel.locator('#supplyQuantity').fill('0');
  const mixedResponsePromise = waitForRequest(page, 'POST', '/api/supplies/bulk');
  await supplyPanel.getByRole('button', { name: 'Enregistrer l’Approvisionnement' }).click();
  const mixedResponse = await mixedResponsePromise;
  await expectProblemDetails(mixedResponse, {
    status: 400,
    code: 'bulk_supply.validation',
    fields: ['lines[0].quantity', 'lines[1].ean13'],
  });
  await expect(supplyPanel.locator('#supply-quantity-error')).toContainText('quantité');
  await expect(supplyPanel.locator('#supply-ean13-1-error')).toContainText('introuvable');
  await expect(supplyPanel.locator('#supply-status')).toContainText('invalide');
  await expect(supplyPanel.locator('#supplyEan13')).toHaveValue(activeEan13);
  await expect(supplyPanel.locator('#supplyQuantity')).toHaveValue('0');
  await expect(supplyPanel.locator('#supplyEan13-1')).toHaveValue(unknownEan13);
  await expect(supplyPanel.locator('#supplyQuantity-1')).toHaveValue('5');
  await expect(readStock(page, activeEan13)).resolves.toMatchObject({ physicalQuantity: 8 });
  expect((await page.request.get(`${apiBaseUrl}/api/stock/${unknownEan13}`)).status()).toBe(404);
});

test('leaves every known Article unchanged when another Opération en masse line is invalid', async ({ page }) => {
  const supplyPanel = page.locator('#supply-panel');
  await page.goto('/stock/approvisionnements');
  await supplyPanel.locator('#supplyEan13').fill(activeEan13);
  await supplyPanel.locator('#supplyQuantity').fill('3');
  await supplyPanel.getByRole('button', { name: 'Ajouter une ligne' }).click();
  await supplyPanel.locator('#supplyEan13-1').fill(secondActiveEan13);
  await supplyPanel.locator('#supplyQuantity-1').fill('0');
  const responsePromise = waitForRequest(page, 'POST', '/api/supplies/bulk');
  await supplyPanel.getByRole('button', { name: 'Enregistrer l’Approvisionnement' }).click();
  const response = await responsePromise;

  await expectProblemDetails(response, {
    status: 400,
    code: 'bulk_supply.validation',
    fields: ['lines[1].quantity'],
  });
  await expect(supplyPanel.locator('#supply-quantity-1-error')).toContainText('quantité');
  await expect(supplyPanel.locator('#supplyEan13')).toHaveValue(activeEan13);
  await expect(supplyPanel.locator('#supplyQuantity')).toHaveValue('3');
  await expect(supplyPanel.locator('#supplyEan13-1')).toHaveValue(secondActiveEan13);
  await expect(supplyPanel.locator('#supplyQuantity-1')).toHaveValue('0');
  await expect(readStock(page, activeEan13)).resolves.toMatchObject({ physicalQuantity: 8 });
  await expect(readStock(page, secondActiveEan13)).resolves.toMatchObject({ physicalQuantity: 0 });
});

test('rejects a duplicate EAN-13 in one Opération en masse without partial application', async ({ page }) => {
  const supplyPanel = page.locator('#supply-panel');
  await page.goto('/stock/approvisionnements');
  await supplyPanel.locator('#supplyEan13').fill(activeEan13);
  await supplyPanel.locator('#supplyQuantity').fill('3');
  await supplyPanel.getByRole('button', { name: 'Ajouter une ligne' }).click();
  await supplyPanel.locator('#supplyEan13-1').fill(activeEan13);
  await supplyPanel.locator('#supplyQuantity-1').fill('5');
  const responsePromise = waitForRequest(page, 'POST', '/api/supplies/bulk');
  await supplyPanel.getByRole('button', { name: 'Enregistrer l’Approvisionnement' }).click();
  const response = await responsePromise;

  await expectProblemDetails(response, {
    status: 400,
    code: 'bulk_supply.validation',
    fields: ['lines[0].ean13', 'lines[1].ean13'],
  });
  await expect(supplyPanel.locator('#supply-ean13-error')).toContainText('seule');
  await expect(supplyPanel.locator('#supply-ean13-1-error')).toContainText('seule');
  await expect(supplyPanel.locator('#supply-status')).toContainText('invalide');
  await expect(readStock(page, activeEan13)).resolves.toMatchObject({ physicalQuantity: 8 });
  await page.screenshot({ path: 'artifacts/playwright/bulk-supply.png', fullPage: true });
});

test('rejects an empty Opération en masse collection without changing Stock or Historique', async ({ page }) => {
  const stockBeforeResponse = await page.request.get(`${apiBaseUrl}/api/stock`);
  const historyBeforeResponse = await page.request.get(`${apiBaseUrl}/api/history`);
  expect(stockBeforeResponse.status()).toBe(200);
  expect(historyBeforeResponse.status()).toBe(200);
  const stockBefore = await stockBeforeResponse.json();
  const historyBefore = await historyBeforeResponse.json();

  const response = await page.request.post(`${apiBaseUrl}/api/supplies/bulk`, {
    data: { lines: [] },
  });
  await expectProblemDetails(response, {
    status: 400,
    code: 'bulk_supply.validation',
    fields: ['lines'],
  });

  const stockAfterResponse = await page.request.get(`${apiBaseUrl}/api/stock`);
  const historyAfterResponse = await page.request.get(`${apiBaseUrl}/api/history`);
  expect(await stockAfterResponse.json()).toEqual(stockBefore);
  expect(await historyAfterResponse.json()).toEqual(historyBefore);
});
