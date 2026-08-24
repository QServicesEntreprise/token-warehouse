import { expect } from '@playwright/test';
import { apiUrl as apiBaseUrl, test } from './fixtures';
import { ean13ForAttempt, leadingZeroEan13 } from './helpers/ean13';
import { expectProblemDetails, waitForRequest } from './helpers/http';
import {
  archive,
  createFoodArticle,
  createNonFoodArticle,
  inventory as prepareInventory,
  reactivate,
  sell,
  supply as prepareSupply,
  supplyBulk as prepareBulkSupply,
} from './helpers/state';

const ean13 = leadingZeroEan13;
const otherEan13 = '1234567890128';
const inventoryEan13 = '3456789012340';
const bulkFirstEan13 = '5678901234562';
const bulkSecondEan13 = '4567890123456';
const emptyHistoryEan13 = '2345678901234';
const invalidHistoryEan13 = '4006381333932';

type BrowserHistoryEntry = {
  id: string;
  type: string;
  quantity?: number;
  previousPhysicalStock?: number;
  countedQuantity?: number;
  difference?: number;
  resultingPhysicalStock?: number;
  previousStatus?: string;
  nextStatus?: string;
  changes?: Array<{ field: string; before?: string; after?: string }>;
  financial?: {
    context: string | null;
    taxRate: { ratio: string };
    amountHtCents: number;
    vatCents: number;
    amountTtcCents: number;
  };
  financialReversal?: {
    sourceOperationId: string;
    context: string | null;
    taxRate: { ratio: string };
    unitPriceHtCents: number;
    amountHtCents: number;
    vatCents: number;
    amountTtcCents: number;
  };
  lines: Array<{
    lineNumber: number;
    ean13: string;
    quantity?: number;
    previousPhysicalStock?: number;
    stockEffect?: number;
    inverseEffect?: number;
    countedQuantity?: number;
    difference?: number;
    resultingPhysicalStock?: number;
  }>;
};

test('consults global and Article history after real Stock operations', async ({ page }) => {
  const supply = await prepareSupply(page, ean13, 5);
  const bulkSupply = await prepareBulkSupply(page, [
    { ean13: bulkFirstEan13, quantity: 2 },
    { ean13: bulkSecondEan13, quantity: 3 },
  ]);
  expect(bulkSupply.operation.lines).toEqual([
    { lineNumber: 1, ean13: bulkFirstEan13, quantity: 2 },
    { lineNumber: 2, ean13: bulkSecondEan13, quantity: 3 },
  ]);
  const inventory = await prepareInventory(page, ean13, 12);
  const otherSupply = await prepareSupply(page, otherEan13, 1);
  const otherInventory = await prepareInventory(page, otherEan13, 7);
  const zeroInventory = await prepareInventory(page, inventoryEan13, 3);

  await page.goto('/stock/corrections');
  const sourcesResponsePromise = waitForRequest(page, 'GET', '/api/stock/counter-movements/sources');
  await page.locator('#counter-movement-load').click();
  expect((await sourcesResponsePromise).status()).toBe(200);
  await page.locator('#counter-movement-source').selectOption(inventory.operation.id);
  await page.locator('#counter-movement-justification').fill('Contrôle Historique');
  const counterResponsePromise = waitForRequest(page, 'POST', '/api/stock/counter-movements');
  await page.locator('#counter-movement-submit').click();
  const counterResponse = await counterResponsePromise;
  expect(counterResponse.status()).toBe(201);
  const counter = await counterResponse.json() as { counterMovement: { id: string; lines: Array<{ inverseEffect: number }> } };
  expect(counter.counterMovement.lines).toHaveLength(1);
  expect(counter.counterMovement.lines[0].inverseEffect).toBe(-2);

  const otherCounterResponsePromise = waitForRequest(page, 'POST', '/api/stock/counter-movements');
  await page.locator('#counter-movement-source').selectOption(otherInventory.operation.id);
  await page.locator('#counter-movement-justification').fill('Correction positive Historique');
  await page.locator('#counter-movement-submit').click();
  const otherCounterResponse = await otherCounterResponsePromise;
  expect(otherCounterResponse.status()).toBe(201);
  const otherCounter = await otherCounterResponse.json() as { counterMovement: { id: string; lines: Array<{ inverseEffect: number }> } };
  expect(otherCounter).toMatchObject({
    counterMovement: { lines: [{ inverseEffect: 1 }] },
  });

  const zeroCounterResponsePromise = waitForRequest(page, 'POST', '/api/stock/counter-movements');
  await page.locator('#counter-movement-source').selectOption(zeroInventory.operation.id);
  await page.locator('#counter-movement-justification').fill('Correction nulle Historique');
  await page.locator('#counter-movement-submit').click();
  const zeroCounterResponse = await zeroCounterResponsePromise;
  expect(zeroCounterResponse.status()).toBe(201);
  const zeroCounter = await zeroCounterResponse.json() as { counterMovement: { id: string; lines: Array<{ inverseEffect: number }> } };
  expect(zeroCounter).toMatchObject({
    counterMovement: { lines: [{ inverseEffect: 0 }] },
  });

  await page.getByRole('link', { name: 'Historique' }).click();
  const globalHistoryPromise = waitForRequest(page, 'GET', '/api/history', (url) => (
    !url.search
  ));
  await page.getByRole('button', { name: 'Historique global', exact: true }).click();
  const globalHistory = await globalHistoryPromise;
  expect(globalHistory.status()).toBe(200);
  const globalEntries = await globalHistory.json() as BrowserHistoryEntry[];
  expect(globalEntries.map((entry) => entry.id)).toEqual(expect.arrayContaining([
    supply.operation.id,
    bulkSupply.operation.id,
    inventory.operation.id,
    otherSupply.operation.id,
  ]));
  expect(globalEntries.map((entry) => entry.type)).toEqual(expect.arrayContaining([
    'SUPPLY',
    'INVENTORY',
    'COUNTER_MOVEMENT',
  ]));
  const bulkHistory = globalEntries.find((entry) => entry.id === bulkSupply.operation.id);
  expect(bulkHistory).toMatchObject({
    type: 'SUPPLY',
    lines: [
      { lineNumber: 1, ean13: bulkFirstEan13, quantity: 2, stockEffect: 2, resultingPhysicalStock: 2 },
      { lineNumber: 2, ean13: bulkSecondEan13, quantity: 3, stockEffect: 3, resultingPhysicalStock: 11 },
    ],
  });
  expect(bulkHistory?.quantity).toBeUndefined();
  expect(bulkHistory?.previousPhysicalStock).toBeUndefined();
  expect(bulkHistory?.resultingPhysicalStock).toBeUndefined();
  expect(globalEntries.find((entry) => entry.id === inventory.operation.id)).toMatchObject({
    id: inventory.operation.id,
    type: 'INVENTORY',
    countedQuantity: 12,
    difference: 2,
    resultingPhysicalStock: 12,
    lines: [{ lineNumber: 1, ean13, countedQuantity: 12, difference: 2, resultingPhysicalStock: 12 }],
  });
  expect(globalEntries.find((entry) => entry.id === otherInventory.operation.id)).toMatchObject({
    id: otherInventory.operation.id,
    type: 'INVENTORY',
    countedQuantity: 7,
    difference: -1,
    resultingPhysicalStock: 7,
    lines: [{ lineNumber: 1, ean13: otherEan13, countedQuantity: 7, difference: -1, resultingPhysicalStock: 7 }],
  });
  expect(globalEntries.find((entry) => entry.id === zeroInventory.operation.id)).toMatchObject({
    id: zeroInventory.operation.id,
    type: 'INVENTORY',
    countedQuantity: 3,
    difference: 0,
    resultingPhysicalStock: 3,
    lines: [{ lineNumber: 1, ean13: inventoryEan13, countedQuantity: 3, difference: 0, resultingPhysicalStock: 3 }],
  });
  const bulkHistoryCard = page.locator(`[aria-labelledby="history-entry-${bulkSupply.operation.id}"]`);
  await expect(bulkHistoryCard).toContainText(bulkFirstEan13);
  await expect(bulkHistoryCard).toContainText('2 unités');
  await expect(bulkHistoryCard).toContainText('effet +2');
  await expect(bulkHistoryCard).toContainText('résultat 2');
  await expect(bulkHistoryCard).toContainText(bulkSecondEan13);
  await expect(bulkHistoryCard).toContainText('3 unités');
  await expect(bulkHistoryCard).toContainText('effet +3');
  await expect(bulkHistoryCard).toContainText('résultat 11');
  await expect(bulkHistoryCard).not.toContainText('Quantité utile');
  await expect(bulkHistoryCard).not.toContainText('Stock physique résultant');
  const positiveInventoryCard = page.locator(`[aria-labelledby="history-entry-${inventory.operation.id}"]`);
  await expect(positiveInventoryCard).toContainText('Quantité comptée');
  await expect(positiveInventoryCard).toContainText('12 unités');
  await expect(positiveInventoryCard).toContainText('+2');
  await expect(positiveInventoryCard).toContainText('Stock physique résultant');
  const negativeInventoryCard = page.locator(`[aria-labelledby="history-entry-${otherInventory.operation.id}"]`);
  await expect(negativeInventoryCard).toContainText('Quantité comptée');
  await expect(negativeInventoryCard).toContainText('7 unités');
  await expect(negativeInventoryCard).toContainText('-1');
  await expect(negativeInventoryCard).toContainText('Stock physique résultant');
  const zeroInventoryCard = page.locator(`[aria-labelledby="history-entry-${zeroInventory.operation.id}"]`);
  await expect(zeroInventoryCard).toContainText('Quantité comptée');
  await expect(zeroInventoryCard).toContainText('3 unités');
  await expect(zeroInventoryCard).toContainText('Écart');
  await expect(zeroInventoryCard).toContainText('Stock physique résultant');
  await expect(page.locator('#history-list')).toContainText('Contrôle Historique');
  await expect(page.locator('#history-list')).toContainText(ean13);

  await page.locator('#history-ean13').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Filtrer l’Historique', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Historique global', exact: true })).toBeFocused();
  await expect(page.locator('#history-state')).toHaveAttribute('role', 'status');
  await expect(page.locator('#history-state')).toHaveAttribute('aria-live', 'polite');

  const filteredHistoryPromise = waitForRequest(page, 'GET', '/api/history', (url) => (
    url.searchParams.get('ean13') === ean13
  ));
  await page.locator('#history-ean13').fill(ean13);
  await page.getByRole('button', { name: 'Filtrer l’Historique', exact: true }).click();
  expect((await filteredHistoryPromise).status()).toBe(200);
  await expect(page.locator('#history-list')).toContainText(ean13);

  const resetGlobalHistoryPromise = waitForRequest(page, 'GET', '/api/history', (url) => (
    !url.search
  ));
  await page.getByRole('button', { name: 'Historique global', exact: true }).click();
  expect((await resetGlobalHistoryPromise).status()).toBe(200);
  await expect(page.locator('#history-ean13')).toHaveValue('');
  await expect(page.locator('#history-list')).toContainText(otherSupply.operation.id);
  await expect(page.locator('#history-list')).toContainText('effet inverse -2');
  await expect(page.locator('#history-list')).toContainText('effet inverse +1');
  await expect(page.locator('#history-list')).toContainText('effet inverse 0');

  for (const { id, inverseEffect } of [
    { id: counter.counterMovement.id, inverseEffect: -2 },
    { id: otherCounter.counterMovement.id, inverseEffect: 1 },
    { id: zeroCounter.counterMovement.id, inverseEffect: 0 },
  ]) {
    const history = globalEntries.find((entry) => entry.id === id);
    expect(history).toBeDefined();
    expect(history?.previousPhysicalStock).toBeUndefined();
    expect(history?.lines.every((line) => line.previousPhysicalStock === undefined)).toBe(true);
    const card = page.locator(`[aria-labelledby="history-entry-${id}"]`);
    await expect(card).toContainText(`effet inverse ${inverseEffect > 0 ? '+' : ''}${inverseEffect}`);
    await expect(card).not.toContainText('Stock physique précédent');
    await expect(card).not.toContainText('précédent');
  }

  const filteredBulkHistoryPromise = waitForRequest(page, 'GET', '/api/history', (url) => (
    url.searchParams.get('ean13') === bulkFirstEan13
  ));
  await page.locator('#history-ean13').fill(bulkFirstEan13);
  await page.getByRole('button', { name: 'Filtrer l’Historique', exact: true }).click();
  const filteredBulkHistoryResponse = await filteredBulkHistoryPromise;
  expect(filteredBulkHistoryResponse.status()).toBe(200);
  const filteredBulkEntries = await filteredBulkHistoryResponse.json() as BrowserHistoryEntry[];
  const filteredBulkHistory = filteredBulkEntries.find((entry) => entry.id === bulkSupply.operation.id);
  expect(filteredBulkHistory).toMatchObject({
    id: bulkSupply.operation.id,
    type: 'SUPPLY',
    lines: [
      { lineNumber: 1, ean13: bulkFirstEan13, quantity: 2, stockEffect: 2, resultingPhysicalStock: 2 },
    ],
  });
  const filteredBulkHistoryCard = page.locator(`[aria-labelledby="history-entry-${bulkSupply.operation.id}"]`);
  await expect(filteredBulkHistoryCard).toContainText('2 unités');
  await expect(filteredBulkHistoryCard).toContainText('effet +2');
  await expect(filteredBulkHistoryCard).toContainText('résultat 2');
  await expect(filteredBulkHistoryCard).not.toContainText('Quantité utile');
  await expect(filteredBulkHistoryCard).not.toContainText('Stock physique résultant');

  await archive(page, ean13);
  await reactivate(page, ean13);

  const articleHistoryPromise = waitForRequest(page, 'GET', '/api/history', (url) => (
    url.searchParams.get('ean13') === ean13
  ));
  await page.locator('#history-ean13').fill(ean13);
  await page.getByRole('button', { name: 'Filtrer l’Historique', exact: true }).click();
  const articleHistoryResponse = await articleHistoryPromise;
  expect(articleHistoryResponse.status()).toBe(200);
  const articleHistoryEntries = await articleHistoryResponse.json() as BrowserHistoryEntry[];
  expect(articleHistoryEntries.find((entry) => entry.id === inventory.operation.id)).toMatchObject({
    id: inventory.operation.id,
    countedQuantity: 12,
    difference: 2,
    resultingPhysicalStock: 12,
    lines: [{ ean13, countedQuantity: 12, difference: 2, resultingPhysicalStock: 12 }],
  });
  expect(articleHistoryEntries.find((entry) => entry.type === 'CATALOG_ARCHIVE')).toMatchObject({
    previousStatus: 'active',
    nextStatus: 'archived',
  });
  expect(articleHistoryEntries.find((entry) => entry.type === 'CATALOG_REACTIVATE')).toMatchObject({
    previousStatus: 'archived',
    nextStatus: 'active',
  });
  await expect(page.locator('#history-list')).toContainText('Inventaire');
  const articlePositiveInventoryCard = page.locator(`[aria-labelledby="history-entry-${inventory.operation.id}"]`);
  await expect(articlePositiveInventoryCard).toContainText('Quantité comptée');
  await expect(articlePositiveInventoryCard).toContainText('12 unités');
  await expect(articlePositiveInventoryCard).toContainText('+2');
  await expect(articlePositiveInventoryCard).toContainText('12 unités');
  await expect(page.locator('#history-list')).toContainText('effet inverse -2');
  await expect(page.locator('#history-list')).toContainText(inventory.operation.id);
  await expect(page.locator('#history-list')).toContainText(counter.counterMovement.id);
  await expect(page.locator('#history-list')).toContainText('Contrôle Historique');
  await expect(page.locator('#history-list')).toContainText('active');
  await expect(page.locator('#history-list')).toContainText('archived');
  await expect(page.locator('#history-list')).toContainText('Archivage Catalogue');
  await expect(page.locator('#history-list')).toContainText('Réactivation Catalogue');
  const articleCounterCard = page.locator(`[aria-labelledby="history-entry-${counter.counterMovement.id}"]`);
  await expect(articleCounterCard).toContainText('effet inverse -2');
  await expect(articleCounterCard).not.toContainText('précédent');

  const otherArticleHistoryPromise = waitForRequest(page, 'GET', '/api/history', (url) => (
    url.searchParams.get('ean13') === otherEan13
  ));
  await page.locator('#history-ean13').fill(otherEan13);
  await page.getByRole('button', { name: 'Filtrer l’Historique', exact: true }).click();
  const otherArticleHistoryResponse = await otherArticleHistoryPromise;
  expect(otherArticleHistoryResponse.status()).toBe(200);
  const otherArticleHistoryEntries = await otherArticleHistoryResponse.json() as BrowserHistoryEntry[];
  expect(otherArticleHistoryEntries.find((entry) => entry.id === otherInventory.operation.id)).toMatchObject({
    id: otherInventory.operation.id,
    countedQuantity: 7,
    difference: -1,
    resultingPhysicalStock: 7,
    lines: [{ ean13: otherEan13, countedQuantity: 7, difference: -1, resultingPhysicalStock: 7 }],
  });
  const otherArticleInventoryCard = page.locator(`[aria-labelledby="history-entry-${otherInventory.operation.id}"]`);
  await expect(otherArticleInventoryCard).toContainText('Quantité comptée');
  await expect(otherArticleInventoryCard).toContainText('7 unités');
  await expect(otherArticleInventoryCard).toContainText('-1');
  await expect(otherArticleInventoryCard).toContainText('7 unités');
  await expect(page.locator('#history-list')).toContainText('effet inverse +1');
  const otherArticleCounterCard = page.locator(`[aria-labelledby="history-entry-${otherCounter.counterMovement.id}"]`);
  await expect(otherArticleCounterCard).toContainText('effet inverse +1');
  await expect(otherArticleCounterCard).not.toContainText('précédent');

  const inventoryArticleHistoryPromise = waitForRequest(page, 'GET', '/api/history', (url) => (
    url.searchParams.get('ean13') === inventoryEan13
  ));
  await page.locator('#history-ean13').fill(inventoryEan13);
  await page.getByRole('button', { name: 'Filtrer l’Historique', exact: true }).click();
  const inventoryArticleHistoryResponse = await inventoryArticleHistoryPromise;
  expect(inventoryArticleHistoryResponse.status()).toBe(200);
  const inventoryArticleHistoryEntries = await inventoryArticleHistoryResponse.json() as BrowserHistoryEntry[];
  expect(inventoryArticleHistoryEntries.find((entry) => entry.id === zeroInventory.operation.id)).toMatchObject({
    id: zeroInventory.operation.id,
    countedQuantity: 3,
    difference: 0,
    resultingPhysicalStock: 3,
    lines: [{ ean13: inventoryEan13, countedQuantity: 3, difference: 0, resultingPhysicalStock: 3 }],
  });
  const zeroArticleInventoryCard = page.locator(`[aria-labelledby="history-entry-${zeroInventory.operation.id}"]`);
  await expect(zeroArticleInventoryCard).toContainText('Quantité comptée');
  await expect(zeroArticleInventoryCard).toContainText('3 unités');
  await expect(zeroArticleInventoryCard).toContainText('Écart');
  await expect(zeroArticleInventoryCard).toContainText('3 unités');
  await expect(page.locator('#history-list')).toContainText('effet inverse 0');
  const zeroArticleCounterCard = page.locator(`[aria-labelledby="history-entry-${zeroCounter.counterMovement.id}"]`);
  await expect(zeroArticleCounterCard).toContainText('effet inverse 0');
  await expect(zeroArticleCounterCard).not.toContainText('précédent');

  await page.reload();
  await page.getByRole('link', { name: 'Historique' }).click();
  const reloadedHistoryPromise = waitForRequest(page, 'GET', '/api/history', (url) => (
    !url.search
  ));
  await page.getByRole('button', { name: 'Historique global', exact: true }).click();
  expect((await reloadedHistoryPromise).status()).toBe(200);
  await expect(page.locator('#history-list')).toContainText(supply.operation.id);

  const persistedStock = await page.request.get(`${apiBaseUrl}/api/stock/${ean13}`);
  expect(persistedStock.status()).toBe(200);
  await expect(persistedStock.json()).resolves.toMatchObject({ physicalQuantity: 10 });

  await page.route('**/api/history*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.continue();
  }, { times: 1 });
  const loadingHistoryPromise = waitForRequest(page, 'GET', '/api/history', (url) => (
    !url.search
  ));
  await page.getByRole('button', { name: 'Historique global', exact: true }).click();
  await expect(page.locator('#history-state')).toContainText('Chargement');
  expect((await loadingHistoryPromise).status()).toBe(200);

  const emptyHistoryPromise = waitForRequest(page, 'GET', '/api/history', (url) => (
    url.searchParams.get('ean13') === emptyHistoryEan13
  ));
  await page.locator('#history-ean13').fill(emptyHistoryEan13);
  await page.getByRole('button', { name: 'Filtrer l’Historique', exact: true }).click();
  expect((await emptyHistoryPromise).status()).toBe(200);
  await expect(page.locator('#history-state')).toContainText('Aucun fait historique');

  const invalidHistoryPromise = waitForRequest(page, 'GET', '/api/history', (url) => (
    url.searchParams.get('ean13') === invalidHistoryEan13
  ));
  await page.locator('#history-ean13').fill(invalidHistoryEan13);
  await page.getByRole('button', { name: 'Filtrer l’Historique', exact: true }).click();
  expect((await invalidHistoryPromise).status()).toBe(400);
  await expect(page.locator('#history-state')).toContainText('EAN-13');

});

test('keeps a committed Sale and its financial correction separately in History', async ({ page }) => {
  await page.goto('/stock');
  await expect(page.locator('#stock-table').getByRole('row', { name: /Alimentaire aux deux modes/ })).toBeVisible();

  await page.getByRole('link', { name: 'Historique' }).click();
  const initialHistoryPromise = waitForRequest(page, 'GET', '/api/history', (url) => (
    !url.search
  ));
  await page.getByRole('button', { name: 'Historique global', exact: true }).click();
  expect((await initialHistoryPromise).status()).toBe(200);
  await page.getByRole('link', { name: 'Vente', exact: true }).click();

  const saleSearchPromise = waitForRequest(page, 'GET', '/api/sales/articles');
  await page.locator('#sale-search').fill(ean13);
  await page.getByRole('button', { name: 'Rechercher un Article', exact: true }).click();
  expect((await saleSearchPromise).status()).toBe(200);
  await page.locator('#sale-articles-table').getByRole('button', { name: /Sélectionner Alimentaire aux deux modes/ }).click();
  await page.locator('#sale-context-takeaway').check();
  await page.locator('#sale-quantity').fill('2');

  const saleResponsePromise = waitForRequest(page, 'POST', '/api/sales');
  const saleHistoryRefreshPromise = waitForRequest(page, 'GET', '/api/history', (url) => (
    !url.search
  ));
  await page.locator('#sale-submit').click();
  const saleResponse = await saleResponsePromise;
  expect(saleResponse.status()).toBe(201);
  const sale = await saleResponse.json() as {
    operation: { id: string };
    financial: { amountHtCents: number; vatCents: number; amountTtcCents: number };
  };
  expect(sale.financial).toMatchObject({ amountHtCents: 200, vatCents: 11, amountTtcCents: 211 });
  const saleHistoryRefresh = await saleHistoryRefreshPromise;
  expect(saleHistoryRefresh.status()).toBe(200);
  await expect(page.locator('#history-list')).toContainText(sale.operation.id);

  await page.getByRole('link', { name: 'Contre-mouvement' }).click();
  const sourcesPromise = waitForRequest(page, 'GET', '/api/stock/counter-movements/sources');
  await page.locator('#counter-movement-load').click();
  expect((await sourcesPromise).status()).toBe(200);
  await page.locator('#counter-movement-source').selectOption(sale.operation.id);
  await page.locator('#counter-movement-justification').fill('Correction financière E2E');

  const counterResponsePromise = waitForRequest(page, 'POST', '/api/stock/counter-movements');
  await page.locator('#counter-movement-submit').click();
  const counterResponse = await counterResponsePromise;
  expect(counterResponse.status()).toBe(201);

  await page.getByRole('link', { name: 'Historique' }).click();
  const historyPromise = waitForRequest(page, 'GET', '/api/history', (url) => (
    !url.search
  ));
  await page.getByRole('button', { name: 'Historique global', exact: true }).click();
  expect((await historyPromise).status()).toBe(200);
  const entries = await historyPromise.then((response) => response.json()) as Array<{
    id: string;
    type: string;
    financial?: { amountHtCents: number; vatCents: number; amountTtcCents: number };
    financialReversal?: { sourceOperationId: string; unitPriceHtCents: number; amountHtCents: number; vatCents: number; amountTtcCents: number };
  }>;
  const saleEntry = entries.find((entry) => entry.id === sale.operation.id);
  expect(saleEntry).toMatchObject({
    type: 'SALE_STOCK',
    financial: {
      context: 'takeaway',
      taxRate: { ratio: '11/200' },
      amountHtCents: 200,
      vatCents: 11,
      amountTtcCents: 211,
    },
  });
  const correctionEntry = entries.find((entry) => entry.type === 'COUNTER_MOVEMENT' && entry.financialReversal);
  expect(correctionEntry).toMatchObject({
    financialReversal: {
      sourceOperationId: sale.operation.id,
      context: 'takeaway',
      unitPriceHtCents: 100,
      taxRate: { ratio: '11/200' },
      amountHtCents: -200,
      vatCents: -11,
      amountTtcCents: -211,
    },
  });
  await expect(page.locator(`[aria-labelledby="history-entry-${sale.operation.id}"]`)).toContainText('200 centimes');
  await expect(page.locator('#history-list')).toContainText('-211 centimes');
  await expect(page.locator(`[aria-labelledby="history-entry-${sale.operation.id}"]`)).toContainText('11/200');
  await expect(page.locator('#history-list')).toContainText('À emporter');
  const correctionCard = page.locator(`[aria-labelledby="history-entry-${correctionEntry!.id}"]`);
  await expect(correctionCard).toContainText('Prix HT unitaire historique');
  await expect(correctionCard).toContainText('100 centimes');

  const articleHistoryPromise = waitForRequest(page, 'GET', '/api/history', (url) => (
    url.searchParams.get('ean13') === ean13
  ));
  await page.locator('#history-ean13').fill(ean13);
  await page.getByRole('button', { name: 'Filtrer l’Historique', exact: true }).click();
  expect((await articleHistoryPromise).status()).toBe(200);
  const articleSaleCard = page.locator(`[aria-labelledby="history-entry-${sale.operation.id}"]`);
  const articleCorrectionCard = page.locator(`[aria-labelledby="history-entry-${correctionEntry!.id}"]`);
  await expect(articleSaleCard).toContainText('À emporter');
  await expect(articleCorrectionCard).toContainText('Prix HT unitaire historique');
  await expect(articleCorrectionCard).toContainText('100 centimes');
  await expect(page.locator('#history-list')).toContainText('À emporter');
  await expect(page.locator('#history-list')).toContainText('11/200');
});

test.describe('history read failure runtime seam', () => {
  test.use({ historyReadFailure: true });

  test('renders the real History API failure as an accessible error state', async ({ page }) => {
    await page.goto('/stock/historique');

    const failurePromise = waitForRequest(page, 'GET', '/api/history', (url) => (
    !url.search
  ));
    await page.getByRole('button', { name: 'Historique global', exact: true }).click();
    const failure = await failurePromise;
    await expectProblemDetails(failure, { status: 500, code: 'HISTORY_READ_FAILURE' });
    await expect(failure.json()).resolves.toMatchObject({
      status: 500,
    });
    await expect(page.locator('#history-state')).toContainText('L’Historique ne peut pas être lu pour le moment.');
    await expect(page.locator('#history-state')).toHaveAttribute('role', 'status');
    await expect(page.locator('#history-state')).toHaveAttribute('aria-live', 'polite');
  });
});

test.describe('complete History behavior', () => {
  test.use({ e2eSeed: 'flows' });

  test('renders all nine History facts and keeps Article History read-only and filtered', async ({ page }) => {
    const foodEan13 = ean13ForAttempt('710000001', 0);
    const nonFoodEan13 = ean13ForAttempt('710000002', 0);
    const foodName = 'Article alimentaire Historique';
    const renamedFood = `${foodName} renommé`;

    await createFoodArticle(page, {
      ean13: foodEan13,
      name: foodName,
      modes: ['takeaway'],
      dlc: '2030-02-01',
      priceHtCents: 250,
    });
    await createNonFoodArticle(page, {
      ean13: nonFoodEan13,
      name: 'Article non alimentaire Historique',
      packaging: 'new',
      priceHtCents: 400,
    });
    const bulkSupply = await prepareBulkSupply(page, [
      { ean13: foodEan13, quantity: 8 },
      { ean13: nonFoodEan13, quantity: 5 },
    ]);
    const sale = await sell(page, foodEan13, 2, 'takeaway');
    const inventoryResult = await prepareInventory(page, foodEan13, 7);
    const counterResponse = await page.request.post(`${apiBaseUrl}/api/stock/counter-movements`, {
      data: {
        sourceOperationId: inventoryResult.operation.id,
        justification: 'Correction de comptage Historique',
      },
    });
    expect(counterResponse.status()).toBe(201);
    const counterMovementResult = await counterResponse.json() as { counterMovement: { id: string } };

    const dlcChange = await page.request.patch(`${apiBaseUrl}/api/articles/${foodEan13}`, {
      data: { dlc: '2030-02-02' },
    });
    expect(dlcChange.status()).toBe(200);
    const catalogChange = await page.request.patch(`${apiBaseUrl}/api/articles/${foodEan13}`, {
      data: { name: renamedFood },
    });
    expect(catalogChange.status()).toBe(200);
    const packagingChange = await page.request.patch(`${apiBaseUrl}/api/articles/${nonFoodEan13}`, {
      data: { packaging: 'refurbished' },
    });
    expect(packagingChange.status()).toBe(200);
    await archive(page, foodEan13);
    await reactivate(page, foodEan13);

    const stockBeforeHistory = await page.request.get(`${apiBaseUrl}/api/stock/${foodEan13}`);
    expect(stockBeforeHistory.status()).toBe(200);
    const stockBeforeHistoryView = await stockBeforeHistory.json();

    await page.goto('/stock/historique');
    const writeRequests: string[] = [];
    const trackWriteRequests = (request: import('@playwright/test').Request) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        writeRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    };
    page.on('request', trackWriteRequests);
    const globalHistoryPromise = waitForRequest(page, 'GET', '/api/history', (url) => !url.search);
    await page.getByRole('button', { name: 'Historique global', exact: true }).click();
    expect((await globalHistoryPromise).status()).toBe(200);

    for (const label of [
      'Approvisionnement',
      'Inventaire',
      'Vente Stock',
      'Contre-mouvement',
      'Archivage Catalogue',
      'Réactivation Catalogue',
      'Changement de DLC',
      'Changement de Packaging',
      'Changement Catalogue',
    ]) {
      await expect(page.locator('#history-list').getByRole('heading', {
        level: 3,
        name: new RegExp(`^${label} — `),
      }).first()).toBeVisible();
    }

    const headings = page.locator('#history-list > .history-entry > h3');
    await expect(headings).toContainText([
      'Approvisionnement — 2030-01-15T10:00:00+00:00',
      'Inventaire — 2030-01-13T10:00:00+00:00',
      'Vente Stock — 2030-01-12T11:00:00+00:00',
      'Contre-mouvement — 2030-01-11T11:00:00+00:00',
    ]);
    const renderedTimestamps = (await headings.allTextContents()).map((heading) => (
      Date.parse(heading.split('—').at(-1)?.trim() ?? '')
    ));
    expect(renderedTimestamps.every(Number.isFinite)).toBe(true);
    expect(new Set(renderedTimestamps).size).toBeGreaterThanOrEqual(4);
    expect(renderedTimestamps).toEqual([...renderedTimestamps].sort((left, right) => right - left));

    const supplyCard = page.locator(`[aria-labelledby="history-entry-${bulkSupply.operation.id}"]`);
    await expect(supplyCard).toContainText(foodEan13);
    await expect(supplyCard).toContainText(nonFoodEan13);
    await expect(supplyCard).toContainText('Ligne 1');
    await expect(supplyCard).toContainText('8 unités');
    await expect(supplyCard).toContainText('effet +8');
    await expect(supplyCard).toContainText('Ligne 2');
    await expect(supplyCard).toContainText('5 unités');
    await expect(supplyCard).toContainText('effet +5');

    const saleCard = page.locator(`[aria-labelledby="history-entry-${sale.operation.id}"]`);
    await expect(saleCard).toContainText('Quantité utile');
    await expect(saleCard).toContainText('2 unités');
    await expect(saleCard).toContainText('Effet Stock');
    await expect(saleCard).toContainText('-2');
    await expect(saleCard).toContainText('Prix HT unitaire historique');
    await expect(saleCard).toContainText('250 centimes');
    await expect(saleCard).toContainText('Montant TTC historique');
    await expect(saleCard).toContainText('528 centimes');

    const inventoryCard = page.locator(`[aria-labelledby="history-entry-${inventoryResult.operation.id}"]`);
    await expect(inventoryCard).toContainText('Quantité comptée');
    await expect(inventoryCard).toContainText('7 unités');
    await expect(inventoryCard).toContainText('Écart');
    await expect(inventoryCard).toContainText('+1');

    const counterCard = page.locator(`[aria-labelledby="history-entry-${counterMovementResult.counterMovement.id}"]`);
    await expect(counterCard).toContainText(`Source${inventoryResult.operation.id}`);
    await expect(counterCard).toContainText('JustificationCorrection de comptage Historique');
    await expect(counterCard).toContainText('effet inverse -1');

    const historyEntries = page.locator('#history-list > .history-entry');
    await expect(historyEntries.filter({ hasText: 'Changement de DLC' })).toContainText(
      'dlc : 2030-02-01 → 2030-02-02',
    );
    await expect(historyEntries.filter({ hasText: 'Changement de Packaging' })).toContainText(
      'packaging : new → refurbished',
    );
    await expect(historyEntries.filter({ hasText: 'Changement Catalogue' })).toContainText(
      `name : ${foodName} → ${renamedFood}`,
    );
    await expect(historyEntries.filter({ hasText: 'Archivage Catalogue' })).toContainText('active → archived');
    await expect(historyEntries.filter({ hasText: 'Réactivation Catalogue' })).toContainText('archived → active');

    const historyPanel = page.locator('#history-panel');
    await expect(historyPanel.getByRole('button')).toHaveText([
      'Filtrer l’Historique',
      'Historique global',
    ]);
    await expect(historyPanel.getByRole('button', {
      name: /Enregistrer|Archiver|Réactiver|Corriger|Supprimer/,
    })).toHaveCount(0);

    const articleHistoryPromise = waitForRequest(page, 'GET', '/api/history', (url) => (
      url.searchParams.get('ean13') === foodEan13
    ));
    await page.locator('#history-ean13').fill(foodEan13);
    await page.getByRole('button', { name: 'Filtrer l’Historique', exact: true }).click();
    expect((await articleHistoryPromise).status()).toBe(200);

    const articleHistory = page.locator('#history-list');
    await expect(articleHistory).toContainText(foodEan13);
    await expect(articleHistory).not.toContainText(nonFoodEan13);
    await expect(articleHistory).toContainText('Changement de DLC');
    await expect(articleHistory).toContainText('dlc : 2030-02-01 → 2030-02-02');
    await expect(articleHistory).toContainText('Changement Catalogue');
    await expect(articleHistory).toContainText(`name : ${foodName} → ${renamedFood}`);
    await expect(articleHistory).not.toContainText('Changement de Packaging');
    page.off('request', trackWriteRequests);
    expect(writeRequests).toEqual([]);
    const stockAfterHistory = await page.request.get(`${apiBaseUrl}/api/stock/${foodEan13}`);
    expect(stockAfterHistory.status()).toBe(200);
    await expect(stockAfterHistory.json()).resolves.toEqual(stockBeforeHistoryView);
  });
});
