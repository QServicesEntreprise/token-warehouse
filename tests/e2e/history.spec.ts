import { expect } from '@playwright/test';
import { test } from './fixtures';

const ean13 = '0123456789012';
const apiBaseUrl = 'http://127.0.0.1:5100';

test('consults global and Article history after real Stock operations', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#stock-table').getByRole('row', { name: /DLC de démonstration/ })).toContainText('8 unités');

  const supplyResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/supplies';
  });
  await page.locator('#supplyEan13').fill(ean13);
  await page.locator('#supplyQuantity').fill('2');
  await page.locator('#supply-form button[type="submit"]').click();
  const supplyResponse = await supplyResponsePromise;
  expect(supplyResponse.status()).toBe(201);
  const supply = await supplyResponse.json() as { operation: { id: string } };

  const inventoryResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/inventories';
  });
  await page.locator('#inventory-ean13').fill(ean13);
  await page.locator('#inventory-countedQuantity').fill('10');
  await page.locator('#inventory-form button[type="submit"]').click();
  const inventoryResponse = await inventoryResponsePromise;
  expect(inventoryResponse.status()).toBe(201);
  const inventory = await inventoryResponse.json() as { operation: { id: string } };

  await page.getByRole('link', { name: 'Contre-mouvement' }).click();
  const sourcesResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname === '/api/stock/counter-movements/sources';
  });
  await page.locator('#counter-movement-load').click();
  expect((await sourcesResponsePromise).status()).toBe(200);
  await page.locator('#counter-movement-source').selectOption(inventory.operation.id);
  await page.locator('#counter-movement-justification').fill('Contrôle Historique');
  const counterResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/stock/counter-movements';
  });
  await page.locator('#counter-movement-submit').click();
  expect((await counterResponsePromise).status()).toBe(201);

  await page.getByRole('link', { name: 'Historique' }).click();
  const globalHistoryPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api/history' && !url.search;
  });
  await page.getByRole('button', { name: 'Historique global', exact: true }).click();
  const globalHistory = await globalHistoryPromise;
  expect(globalHistory.status()).toBe(200);
  const globalEntries = await globalHistory.json() as Array<{ id: string; type: string }>;
  expect(globalEntries.map((entry) => entry.id)).toEqual(expect.arrayContaining([
    supply.operation.id,
    inventory.operation.id,
  ]));
  expect(globalEntries.map((entry) => entry.type)).toEqual(expect.arrayContaining([
    'SUPPLY',
    'INVENTORY',
    'COUNTER_MOVEMENT',
  ]));
  await expect(page.locator('#history-list')).toContainText('Contrôle Historique');
  await expect(page.locator('#history-list')).toContainText(ean13);

  const filteredHistoryPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname === '/api/history'
      && url.searchParams.get('ean13') === ean13;
  });
  await page.locator('#history-ean13').fill(ean13);
  await page.getByRole('button', { name: 'Filtrer l’Historique', exact: true }).click();
  expect((await filteredHistoryPromise).status()).toBe(200);
  await expect(page.locator('#history-list')).toContainText(ean13);

  const articleResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === `/api/articles/${ean13}`;
  });
  await page.locator('#lookupEan13').fill(ean13);
  await page.locator('section[aria-labelledby="lookup-title"]').getByRole('button', { name: 'Consulter', exact: true }).click();
  expect((await articleResponsePromise).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'DLC de démonstration' })).toBeVisible();

  const articleHistoryPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname === '/api/history'
      && url.searchParams.get('ean13') === ean13;
  });
  await page.getByRole('button', { name: 'Consulter l’Historique de cet Article', exact: true }).click();
  expect((await articleHistoryPromise).status()).toBe(200);
  await expect(page.locator('#article-history-list')).toContainText('Inventaire');
  await expect(page.locator('#article-history-list')).toContainText('10');

  await page.reload();
  await page.getByRole('link', { name: 'Historique' }).click();
  const reloadedHistoryPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api/history' && !url.search;
  });
  await page.getByRole('button', { name: 'Historique global', exact: true }).click();
  expect((await reloadedHistoryPromise).status()).toBe(200);
  await expect(page.locator('#history-list')).toContainText(supply.operation.id);

  const persistedStock = await page.request.get(`${apiBaseUrl}/api/stock/${ean13}`);
  expect(persistedStock.status()).toBe(200);
  await expect(persistedStock.json()).resolves.toMatchObject({ physicalQuantity: 10 });
});
