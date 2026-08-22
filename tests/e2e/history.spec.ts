import { expect } from '@playwright/test';
import { test } from './fixtures';

const ean13 = '0123456789012';
const otherEan13 = '1234567890128';
const inventoryEan13 = '3456789012340';
const bulkFirstEan13 = '5678901234562';
const bulkSecondEan13 = '4567890123456';
const emptyHistoryEan13 = '2345678901234';
const invalidHistoryEan13 = '4006381333932';
const apiBaseUrl = 'http://127.0.0.1:5100';

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
  await page.goto('/');
  await expect(page.locator('#stock-table').getByRole('row', { name: /Alimentaire aux deux modes/ })).toContainText('5 unités');

  const supplyResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/supplies';
  });
  await page.locator('#supplyEan13').fill(ean13);
  await page.locator('#supplyQuantity').fill('5');
  await page.locator('#supply-form button[type="submit"]').click();
  const supplyResponse = await supplyResponsePromise;
  expect(supplyResponse.status()).toBe(201);
  const supply = await supplyResponse.json() as { operation: { id: string } };

  const bulkSupplyResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/supplies/bulk';
  });
  await page.locator('#supplyEan13').fill(bulkFirstEan13);
  await page.locator('#supplyQuantity').fill('2');
  await page.locator('#supply-panel').getByRole('button', { name: 'Ajouter une ligne', exact: true }).click();
  await page.locator('#supplyEan13-1').fill(bulkSecondEan13);
  await page.locator('#supplyQuantity-1').fill('3');
  await page.locator('#supply-panel button[type="submit"]').click();
  const bulkSupplyResponse = await bulkSupplyResponsePromise;
  expect(bulkSupplyResponse.status()).toBe(201);
  const bulkSupply = await bulkSupplyResponse.json() as {
    operation: { id: string; lines: Array<{ lineNumber: number; ean13: string; quantity: number }> };
  };
  expect(bulkSupply.operation.lines).toEqual([
    { lineNumber: 1, ean13: bulkFirstEan13, quantity: 2 },
    { lineNumber: 2, ean13: bulkSecondEan13, quantity: 3 },
  ]);
  await page.locator('#supply-panel button[aria-label="Retirer la ligne 2"]').click();

  const inventoryResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/inventories';
  });
  await page.locator('#inventory-ean13').fill(ean13);
  await page.locator('#inventory-countedQuantity').fill('12');
  await page.locator('#inventory-form button[type="submit"]').click();
  const inventoryResponse = await inventoryResponsePromise;
  expect(inventoryResponse.status()).toBe(201);
  const inventory = await inventoryResponse.json() as { operation: { id: string } };

  const otherSupplyResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/supplies';
  });
  await page.locator('#supplyEan13').fill(otherEan13);
  await page.locator('#supplyQuantity').fill('1');
  await page.locator('#supply-form button[type="submit"]').click();
  const otherSupplyResponse = await otherSupplyResponsePromise;
  expect(otherSupplyResponse.status()).toBe(201);
  const otherSupply = await otherSupplyResponse.json() as { operation: { id: string } };

  const otherInventoryResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/inventories';
  });
  await page.locator('#inventory-ean13').fill(otherEan13);
  await page.locator('#inventory-countedQuantity').fill('7');
  await page.locator('#inventory-form button[type="submit"]').click();
  const otherInventoryResponse = await otherInventoryResponsePromise;
  expect(otherInventoryResponse.status()).toBe(201);
  const otherInventory = await otherInventoryResponse.json() as { operation: { id: string } };

  const zeroInventoryResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/inventories';
  });
  await page.locator('#inventory-ean13').fill(inventoryEan13);
  await page.locator('#inventory-countedQuantity').fill('3');
  await page.locator('#inventory-form button[type="submit"]').click();
  const zeroInventoryResponse = await zeroInventoryResponsePromise;
  expect(zeroInventoryResponse.status()).toBe(201);
  const zeroInventory = await zeroInventoryResponse.json() as { operation: { id: string } };

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
  const counterResponse = await counterResponsePromise;
  expect(counterResponse.status()).toBe(201);
  const counter = await counterResponse.json() as { counterMovement: { id: string; lines: Array<{ inverseEffect: number }> } };
  expect(counter.counterMovement.lines).toHaveLength(1);
  expect(counter.counterMovement.lines[0].inverseEffect).toBe(-2);

  const otherCounterResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/stock/counter-movements';
  });
  await page.locator('#counter-movement-source').selectOption(otherInventory.operation.id);
  await page.locator('#counter-movement-justification').fill('Correction positive Historique');
  await page.locator('#counter-movement-submit').click();
  const otherCounterResponse = await otherCounterResponsePromise;
  expect(otherCounterResponse.status()).toBe(201);
  const otherCounter = await otherCounterResponse.json() as { counterMovement: { id: string; lines: Array<{ inverseEffect: number }> } };
  expect(otherCounter).toMatchObject({
    counterMovement: { lines: [{ inverseEffect: 1 }] },
  });

  const zeroCounterResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/stock/counter-movements';
  });
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
  const globalHistoryPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api/history' && !url.search;
  });
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

  const resetGlobalHistoryPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api/history' && !url.search;
  });
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

  const filteredBulkHistoryPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname === '/api/history'
      && url.searchParams.get('ean13') === bulkFirstEan13;
  });
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

  const bulkArticleResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === `/api/articles/${bulkFirstEan13}`;
  });
  await page.locator('#lookupEan13').fill(bulkFirstEan13);
  await page.locator('section[aria-labelledby="lookup-title"]').getByRole('button', { name: 'Consulter', exact: true }).click();
  expect((await bulkArticleResponsePromise).status()).toBe(200);

  const bulkArticleHistoryPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname === '/api/history'
      && url.searchParams.get('ean13') === bulkFirstEan13;
  });
  await page.getByRole('button', { name: 'Consulter l’Historique de cet Article', exact: true }).click();
  const bulkArticleHistoryResponse = await bulkArticleHistoryPromise;
  expect(bulkArticleHistoryResponse.status()).toBe(200);
  const bulkArticleHistoryEntries = await bulkArticleHistoryResponse.json() as BrowserHistoryEntry[];
  expect(bulkArticleHistoryEntries.find((entry) => entry.id === bulkSupply.operation.id)).toMatchObject({
    id: bulkSupply.operation.id,
    lines: [
      { lineNumber: 1, ean13: bulkFirstEan13, quantity: 2, stockEffect: 2, resultingPhysicalStock: 2 },
    ],
  });
  await expect(page.locator('#article-history-list')).toContainText('2 unités');
  await expect(page.locator('#article-history-list')).toContainText('effet +2');
  await expect(page.locator('#article-history-list')).toContainText('résultat 2');

  const articleResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === `/api/articles/${ean13}`;
  });
  await page.locator('#lookupEan13').fill(ean13);
  await page.locator('section[aria-labelledby="lookup-title"]').getByRole('button', { name: 'Consulter', exact: true }).click();
  expect((await articleResponsePromise).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Alimentaire aux deux modes' })).toBeVisible();

  const archiveResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === `/api/articles/${ean13}/archive`;
  });
  await page.getByRole('button', { name: 'Archiver l’Article', exact: true }).click();
  expect((await archiveResponsePromise).status()).toBe(200);

  const reactivateResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === `/api/articles/${ean13}/reactivate`;
  });
  await page.getByRole('button', { name: 'Réactiver l’Article', exact: true }).click();
  expect((await reactivateResponsePromise).status()).toBe(200);

  const articleHistoryPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname === '/api/history'
      && url.searchParams.get('ean13') === ean13;
  });
  await page.getByRole('button', { name: 'Consulter l’Historique de cet Article', exact: true }).click();
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
  await expect(page.locator('#article-history-list')).toContainText('Inventaire');
  const articlePositiveInventoryCard = page.locator(`[aria-labelledby="article-history-entry-${inventory.operation.id}"]`);
  await expect(articlePositiveInventoryCard).toContainText('Quantité comptée');
  await expect(articlePositiveInventoryCard).toContainText('12 unités');
  await expect(articlePositiveInventoryCard).toContainText('+2');
  await expect(articlePositiveInventoryCard).toContainText('résultat : 12 unités');
  await expect(page.locator('#article-history-list')).toContainText('effet inverse -2');
  await expect(page.locator('#article-history-list')).toContainText(`Source : ${inventory.operation.id}`);
  await expect(page.locator('#article-history-list')).toContainText(`Correction : ${counter.counterMovement.id}`);
  await expect(page.locator('#article-history-list')).toContainText('Contrôle Historique');
  await expect(page.locator('#article-history-list')).toContainText(`Corrigé par : ${counter.counterMovement.id}`);
  await expect(page.locator('#article-history-list')).toContainText('active');
  await expect(page.locator('#article-history-list')).toContainText('archived');
  await expect(page.locator('#article-history-panel')).toBeFocused();
  await expect(page.locator('#article-history-list')).toContainText('Archivage Catalogue');
  await expect(page.locator('#article-history-list')).toContainText('Réactivation Catalogue');
  const articleCounterCard = page.locator(`[aria-labelledby="article-history-entry-${counter.counterMovement.id}"]`);
  await expect(articleCounterCard).toContainText('effet inverse -2');
  await expect(articleCounterCard).not.toContainText('précédent');

  const otherArticleResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === `/api/articles/${otherEan13}`;
  });
  await page.locator('#lookupEan13').fill(otherEan13);
  await page.locator('section[aria-labelledby="lookup-title"]').getByRole('button', { name: 'Consulter', exact: true }).click();
  expect((await otherArticleResponsePromise).status()).toBe(200);
  const otherArticleHistoryPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname === '/api/history'
      && url.searchParams.get('ean13') === otherEan13;
  });
  await page.getByRole('button', { name: 'Consulter l’Historique de cet Article', exact: true }).click();
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
  const otherArticleInventoryCard = page.locator(`[aria-labelledby="article-history-entry-${otherInventory.operation.id}"]`);
  await expect(otherArticleInventoryCard).toContainText('Quantité comptée');
  await expect(otherArticleInventoryCard).toContainText('7 unités');
  await expect(otherArticleInventoryCard).toContainText('-1');
  await expect(otherArticleInventoryCard).toContainText('résultat : 7 unités');
  await expect(page.locator('#article-history-list')).toContainText('effet inverse +1');
  const otherArticleCounterCard = page.locator(`[aria-labelledby="article-history-entry-${otherCounter.counterMovement.id}"]`);
  await expect(otherArticleCounterCard).toContainText('effet inverse +1');
  await expect(otherArticleCounterCard).not.toContainText('précédent');

  const inventoryArticleResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === `/api/articles/${inventoryEan13}`;
  });
  await page.locator('#lookupEan13').fill(inventoryEan13);
  await page.locator('section[aria-labelledby="lookup-title"]').getByRole('button', { name: 'Consulter', exact: true }).click();
  expect((await inventoryArticleResponsePromise).status()).toBe(200);
  const inventoryArticleHistoryPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname === '/api/history'
      && url.searchParams.get('ean13') === inventoryEan13;
  });
  await page.getByRole('button', { name: 'Consulter l’Historique de cet Article', exact: true }).click();
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
  const zeroArticleInventoryCard = page.locator(`[aria-labelledby="article-history-entry-${zeroInventory.operation.id}"]`);
  await expect(zeroArticleInventoryCard).toContainText('Quantité comptée');
  await expect(zeroArticleInventoryCard).toContainText('3 unités');
  await expect(zeroArticleInventoryCard).toContainText('Écart');
  await expect(zeroArticleInventoryCard).toContainText('résultat : 3 unités');
  await expect(page.locator('#article-history-list')).toContainText('effet inverse 0');
  const zeroArticleCounterCard = page.locator(`[aria-labelledby="article-history-entry-${zeroCounter.counterMovement.id}"]`);
  await expect(zeroArticleCounterCard).toContainText('effet inverse 0');
  await expect(zeroArticleCounterCard).not.toContainText('précédent');

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

  await page.route('**/api/history*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.continue();
  }, { times: 1 });
  const loadingHistoryPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api/history' && !url.search;
  });
  await page.getByRole('button', { name: 'Historique global', exact: true }).click();
  await expect(page.locator('#history-state')).toContainText('Chargement');
  expect((await loadingHistoryPromise).status()).toBe(200);

  const emptyHistoryPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname === '/api/history'
      && url.searchParams.get('ean13') === emptyHistoryEan13;
  });
  await page.locator('#history-ean13').fill(emptyHistoryEan13);
  await page.getByRole('button', { name: 'Filtrer l’Historique', exact: true }).click();
  expect((await emptyHistoryPromise).status()).toBe(200);
  await expect(page.locator('#history-state')).toContainText('Aucun fait historique');

  const invalidHistoryPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname === '/api/history'
      && url.searchParams.get('ean13') === invalidHistoryEan13;
  });
  await page.locator('#history-ean13').fill(invalidHistoryEan13);
  await page.getByRole('button', { name: 'Filtrer l’Historique', exact: true }).click();
  expect((await invalidHistoryPromise).status()).toBe(400);
  await expect(page.locator('#history-state')).toContainText('EAN-13');

});

test('keeps a committed Sale and its financial correction separately in History', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#stock-table').getByRole('row', { name: /Alimentaire aux deux modes/ })).toBeVisible();

  await page.getByRole('link', { name: 'Historique' }).click();
  const initialHistoryPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api/history' && !url.search;
  });
  await page.getByRole('button', { name: 'Historique global', exact: true }).click();
  expect((await initialHistoryPromise).status()).toBe(200);
  await page.getByRole('link', { name: 'Vente', exact: true }).click();

  const saleSearchPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api/sales/articles';
  });
  await page.locator('#sale-search').fill(ean13);
  await page.getByRole('button', { name: 'Rechercher un Article', exact: true }).click();
  expect((await saleSearchPromise).status()).toBe(200);
  await page.locator('#sale-articles-table').getByRole('button', { name: /Sélectionner Alimentaire aux deux modes/ }).click();
  await page.locator('#sale-context-takeaway').check();
  await page.locator('#sale-quantity').fill('2');

  const saleResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/sales';
  });
  const saleHistoryRefreshPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api/history' && !url.search;
  });
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
  const sourcesPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api/stock/counter-movements/sources';
  });
  await page.locator('#counter-movement-load').click();
  expect((await sourcesPromise).status()).toBe(200);
  await page.locator('#counter-movement-source').selectOption(sale.operation.id);
  await page.locator('#counter-movement-justification').fill('Correction financière E2E');

  const counterResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/stock/counter-movements';
  });
  await page.locator('#counter-movement-submit').click();
  const counterResponse = await counterResponsePromise;
  expect(counterResponse.status()).toBe(201);

  await page.getByRole('link', { name: 'Historique' }).click();
  const historyPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api/history' && !url.search;
  });
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

  const articleResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === `/api/articles/${ean13}`;
  });
  await page.locator('#lookupEan13').fill(ean13);
  await page.locator('section[aria-labelledby="lookup-title"]').getByRole('button', { name: 'Consulter', exact: true }).click();
  expect((await articleResponsePromise).status()).toBe(200);
  const articleHistoryPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname === '/api/history'
      && url.searchParams.get('ean13') === ean13;
  });
  await page.getByRole('button', { name: 'Consulter l’Historique de cet Article', exact: true }).click();
  expect((await articleHistoryPromise).status()).toBe(200);
  const articleSaleCard = page.locator(`[aria-labelledby="article-history-entry-${sale.operation.id}"]`);
  const articleCorrectionCard = page.locator(`[aria-labelledby="article-history-entry-${correctionEntry!.id}"]`);
  await expect(articleSaleCard).toContainText('Contexte À emporter');
  await expect(articleCorrectionCard).toContainText('Prix HT unitaire historique');
  await expect(articleCorrectionCard).toContainText('100 centimes');
  await expect(page.locator('#article-history-list')).toContainText('À emporter');
  await expect(page.locator('#article-history-list')).toContainText('11/200');
});

test.describe('history read failure runtime seam', () => {
  test.use({ historyReadFailure: true });

  test('renders the real History API failure as an accessible error state', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Historique' }).click();

    const failurePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'GET'
        && url.pathname === '/api/history'
        && !url.search;
    });
    await page.getByRole('button', { name: 'Historique global', exact: true }).click();
    const failure = await failurePromise;
    expect(failure.status()).toBe(500);
    expect(failure.headers()['content-type']).toContain('application/problem+json');
    await expect(failure.json()).resolves.toMatchObject({
      status: 500,
      code: 'HISTORY_READ_FAILURE',
    });
    await expect(page.locator('#history-state')).toContainText('L’Historique ne peut pas être lu pour le moment.');
    await expect(page.locator('#history-state')).toHaveAttribute('role', 'status');
    await expect(page.locator('#history-state')).toHaveAttribute('aria-live', 'polite');
  });
});
