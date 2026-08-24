import { expect } from '@playwright/test';
import { apiUrl as apiBaseUrl, test } from './fixtures';
import type { Page, Route } from '@playwright/test';
import { leadingZeroEan13 } from './helpers/ean13';
import { expectProblemDetails, waitForRequest } from './helpers/http';
import { supply } from './helpers/state';

const canonicalEan = leadingZeroEan13;
const archivedEan = '2345678901234';
const unknownEan = '4006381333931';
const timestamp = '2030-01-15T10:00:00+00:00';

type ExpectedReceipt = {
  ean13: string;
  previous: number;
  counted: number;
  difference: string;
  resulting: number;
  sellable: number;
  availability: string;
  reason: string;
};

const result = (page: Page) => page.locator('#inventory-result');

const expectReceipt = async (
  page: Page,
  expected: ExpectedReceipt,
) => {
  const receipt = result(page);
  const field = (label: string) => receipt.locator('dl > div').filter({ hasText: label }).locator('dd');
  await expect(field('EAN-13')).toHaveText(expected.ean13);
  await expect(field('Stock physique précédent')).toHaveText(`${expected.previous} unités`);
  await expect(field('Quantité comptée')).toHaveText(`${expected.counted} unités`);
  await expect(field('Écart d’inventaire')).toHaveText(expected.difference);
  await expect(field('Nouvelle base physique')).toHaveText(`${expected.resulting} unités`);
  await expect(field('Stock vendable')).toHaveText(`${expected.sellable} unités`);
  await expect(field('Disponibilité')).toHaveText(expected.availability);
  await expect(field('Raison')).toHaveText(expected.reason);
  await expect(field('Timestamp UTC')).toHaveText(timestamp);
};

const openInventory = async (page: Page) => {
  await page.goto('/stock/inventaires');
  await expect(page.locator('#stock-table')).toBeVisible();
  await expect(
    page.locator('#stock-table').getByRole('row', { name: /Alimentaire aux deux modes/ }),
  ).toContainText('5 unités');
  await page.locator('#inventory-ean13').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#inventory-countedQuantity')).toBeFocused();
};

const submitInventory = async (
  page: Page,
  ean13: string,
  countedQuantity: number,
): Promise<string> => {
  const submitButton = page.locator('#inventory-form button[type="submit"]');
  const responsePromise = waitForRequest(page, 'POST', '/api/inventories');
  const delayedResponse = async (route: Route) => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await route.continue();
  };
  await page.route('**/api/inventories', delayedResponse);
  try {
    await page.locator('#inventory-ean13').fill(ean13);
    await page.locator('#inventory-countedQuantity').fill(String(countedQuantity));
    await submitButton.click();
    await expect(submitButton).toHaveText('Enregistrement…');
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    expect(response.headers()['content-type']).toContain('application/json');
    await expect(result(page)).toBeVisible();
    await expect(result(page)).toBeFocused();
    return (await response.json() as { operation: { id: string } }).operation.id;
  } finally {
    await page.unroute('**/api/inventories', delayedResponse);
  }
};

const expectIndependentReceipt = async (
  page: Page,
  expected: ExpectedReceipt,
) => {
  await openInventory(page);
  await submitInventory(page, expected.ean13, expected.counted);
  await expectReceipt(page, expected);
  await page.reload();
  await expect(result(page)).toBeVisible();
  await expectReceipt(page, expected);
};

test('reconciles the canonical stock from 5 to 11 with a positive difference', async ({ page }) => {
  await expectIndependentReceipt(page, {
    ean13: canonicalEan,
    previous: 5,
    counted: 11,
    difference: '+6',
    resulting: 11,
    sellable: 11,
    availability: 'Disponible',
    reason: '—',
  });
});

test('reconciles the canonical stock from 5 to 2 with a negative difference', async ({ page }) => {
  await expectIndependentReceipt(page, {
    ean13: canonicalEan,
    previous: 5,
    counted: 2,
    difference: '-3',
    resulting: 2,
    sellable: 2,
    availability: 'Disponible',
    reason: '—',
  });
});

test('reconciles several Articles through one bulk operation and keeps the result after reload', async ({ page }) => {
  await openInventory(page);
  await page.locator('#inventory-add-line').click();
  await page.locator('#inventory-add-line').click();
  await page.locator('#inventory-ean13').fill(canonicalEan);
  await page.locator('#inventory-countedQuantity').fill('11');
  await page.locator('#inventory-ean13-1').fill('4567890123456');
  await page.locator('#inventory-countedQuantity-1').fill('5');
  await page.locator('#inventory-ean13-2').fill('5678901234562');
  await page.locator('#inventory-countedQuantity-2').fill('0');

  const responsePromise = waitForRequest(page, 'POST', '/api/inventories/bulk');
  await page.locator('#inventory-form button[type="submit"]').click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  await expect(page.locator('#inventory-result')).toBeVisible();
  await expect(page.locator('#inventory-result .inventory-result-line')).toHaveCount(3);
  await expect(page.locator('#inventory-result')).toContainText('+6');
  await expect(page.locator('#inventory-result')).toContainText('-3');
  await expect(page.locator('#inventory-result')).toContainText('Écart d’inventaire0');
  await expect(page.locator('#stock-table').getByRole('row', { name: /Alimentaire aux deux modes/ })).toContainText('11 unités');

  await page.reload();
  await expect(page.locator('#inventory-result')).toBeVisible();
  await expect(page.locator('#inventory-result .inventory-result-line')).toHaveCount(3);
  await expect(page.locator('#inventory-result')).toContainText('+6');
  await expect(page.locator('#inventory-result')).toContainText('-3');
  await expect(page.locator('#inventory-result')).toContainText('Écart d’inventaire0');
});

test('rejects a duplicate bulk line without reconciling any Article', async ({ page }) => {
  await openInventory(page);
  await page.locator('#inventory-add-line').click();
  await page.locator('#inventory-ean13').fill(canonicalEan);
  await page.locator('#inventory-countedQuantity').fill('11');
  await page.locator('#inventory-ean13-1').fill(canonicalEan);
  await page.locator('#inventory-countedQuantity-1').fill('2');

  const responsePromise = waitForRequest(page, 'POST', '/api/inventories/bulk');
  await page.locator('#inventory-form button[type="submit"]').click();
  const response = await responsePromise;
  expect(response.status()).toBe(400);
  await expect(page.locator('#inventory-error')).toContainText('invalide');
  await expect(page.locator('#inventory-ean13')).toHaveValue(canonicalEan);
  await expect(page.locator('#inventory-ean13-1')).toHaveValue(canonicalEan);
  await expect(page.locator('#inventory-ean13-error')).toContainText('une seule fois');
  await expect(page.locator('#inventory-ean13-1-error')).toContainText('une seule fois');
  await expect(page.locator('#inventory-ean13')).toBeFocused();
  await expect(result(page)).toHaveCount(0);

  const stock = await page.request.get(`${apiBaseUrl}/api/stock/${canonicalEan}`);
  expect(stock.status()).toBe(200);
  await expect(stock.json()).resolves.toMatchObject({ physicalQuantity: 5 });
});

test('keeps an equal canonical count as a visible zero-difference fact', async ({ page }) => {
  await expectIndependentReceipt(page, {
    ean13: canonicalEan,
    previous: 5,
    counted: 5,
    difference: '0',
    resulting: 5,
    sellable: 5,
    availability: 'Disponible',
    reason: '—',
  });
});

test('accepts a zero canonical count and establishes an empty position', async ({ page }) => {
  await expectIndependentReceipt(page, {
    ean13: canonicalEan,
    previous: 5,
    counted: 0,
    difference: '-5',
    resulting: 0,
    sellable: 0,
    availability: 'Rupture',
    reason: '—',
  });
});

test('inventories an archived Article with residual stock', async ({ page }) => {
  await expectIndependentReceipt(page, {
    ean13: archivedEan,
    previous: 4,
    counted: 2,
    difference: '-2',
    resulting: 2,
    sellable: 0,
    availability: 'Non vendable',
    reason: 'Article archivé',
  });
});

test('preserves invalid input and proves an unknown Article creates no state', async ({ page }) => {
  await openInventory(page);

  let invalidPostCount = 0;
  const invalidPostListener = (request: import('@playwright/test').Request) => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname === '/api/inventories') {
      invalidPostCount += 1;
    }
  };
  page.on('request', invalidPostListener);
  await page.locator('#inventory-ean13').fill(canonicalEan);
  await page.locator('#inventory-countedQuantity').fill('-1');
  await page.locator('#inventory-countedQuantity').press('Enter');
  await expect(page.locator('#inventory-countedQuantity-error')).toContainText('entier');
  page.off('request', invalidPostListener);
  expect(invalidPostCount).toBe(0);
  await expect(page.locator('#inventory-ean13')).toHaveValue(canonicalEan);
  await expect(page.locator('#inventory-countedQuantity')).toHaveValue('-1');
  await expect(page.locator('#inventory-countedQuantity')).toBeFocused();
  await expect(result(page)).toHaveCount(0);

  const beforeUnknown = await page.request.get(`${apiBaseUrl}/api/stock/${unknownEan}`);
  expect(beforeUnknown.status()).toBe(404);

  await page.locator('#inventory-ean13').fill(unknownEan);
  await page.locator('#inventory-countedQuantity').fill('6');
  const unknownResponsePromise = waitForRequest(page, 'POST', '/api/inventories');
  await page.locator('#inventory-countedQuantity').press('Enter');
  const unknownResponse = await unknownResponsePromise;
  await expectProblemDetails(unknownResponse, { status: 404, code: 'ARTICLE_NOT_FOUND' });
  await expect(unknownResponse.json()).resolves.toMatchObject({
    status: 404,
  });
  await expect(page.locator('#inventory-error')).toContainText('introuvable');
  await expect(page.locator('#inventory-ean13')).toHaveValue(unknownEan);
  await expect(page.locator('#inventory-countedQuantity')).toHaveValue('6');
  await expect(page.locator('#inventory-countedQuantity')).toBeFocused();
  await expect(result(page)).toHaveCount(0);

  const afterUnknown = await page.request.get(`${apiBaseUrl}/api/stock/${unknownEan}`);
  expect(afterUnknown.status()).toBe(404);
  const stockCollection = await page.request.get(`${apiBaseUrl}/api/stock`);
  expect(stockCollection.status()).toBe(200);
  const stockPositions = await stockCollection.json() as Array<{ ean13: string }>;
  expect(stockPositions.some((position) => position.ean13 === unknownEan)).toBe(false);
});

test('restores the last committed Inventory through loading and resolved states', async ({ page }) => {
  await openInventory(page);
  const inventoryId = await submitInventory(page, canonicalEan, 9);

  let releaseRestore = () => {};
  const restoreGate = new Promise<void>((resolve) => {
    releaseRestore = resolve;
  });
  const restoreHandler = async (route: Route) => {
    await restoreGate;
    await route.continue();
  };
  await page.route(`**/api/inventories/${inventoryId}`, restoreHandler);
  const restoreResponsePromise = waitForRequest(page, 'GET', `/api/inventories/${inventoryId}`);

  try {
    await page.reload();
    await expect(page.locator('#inventory-restore-state')).toHaveText('Relecture du dernier Inventaire…');
    await expect(result(page)).toHaveCount(0);

    releaseRestore();
    expect((await restoreResponsePromise).status()).toBe(200);
    await expect(result(page)).toBeVisible();
    await expect(page.locator('#inventory-restore-state')).toHaveCount(0);
    await expectReceipt(page, {
      ean13: canonicalEan,
      previous: 5,
      counted: 9,
      difference: '+4',
      resulting: 9,
      sellable: 9,
      availability: 'Disponible',
      reason: '—',
    });
  } finally {
    releaseRestore();
    await page.unroute(`**/api/inventories/${inventoryId}`, restoreHandler);
  }
});

test('reports a restore failure without exposing partial Inventory data', async ({ page }) => {
  await openInventory(page);
  const inventoryId = await submitInventory(page, canonicalEan, 9);

  const restoreHandler = async (route: Route) => route.fulfill({
    status: 500,
    contentType: 'application/problem+json',
    body: JSON.stringify({ status: 500, code: 'PERSISTENCE_FAILURE' }),
  });
  await page.route(`**/api/inventories/${inventoryId}`, restoreHandler);
  const restoreResponsePromise = waitForRequest(page, 'GET', `/api/inventories/${inventoryId}`);

  try {
    await page.reload();
    expect((await restoreResponsePromise).status()).toBe(500);
    const restoreState = page.locator('#inventory-restore-state');
    await expect(restoreState).toHaveText('Le dernier Inventaire ne peut pas être relu.');
    await expect(restoreState).toHaveAttribute('role', 'alert');
    await expect(result(page)).toHaveCount(0);
  } finally {
    await page.unroute(`**/api/inventories/${inventoryId}`, restoreHandler);
  }
});

test('presents every Inventory reconciliation quantity with literal values', async ({ page }) => {
  await openInventory(page);
  await submitInventory(page, canonicalEan, 9);

  const receipt = result(page);
  const field = (label: string) => receipt.locator('dl > div').filter({ hasText: label }).locator('dd');
  await expect(field('Stock physique précédent')).toHaveText('5 unités');
  await expect(field('Quantité comptée')).toHaveText('9 unités');
  await expect(field('Écart d’inventaire')).toHaveText('+4');
  await expect(field('Nouvelle base physique')).toHaveText('9 unités');
  await expect(field('Stock vendable')).toHaveText('9 unités');
  await expect(field('Disponibilité')).toHaveText('Disponible');
});

test('keeps the Supply fact after inventorying the same Article', async ({ page }) => {
  await openInventory(page);
  const supplyReceipt = await supply(page, canonicalEan, 3);
  const inventoryId = await submitInventory(page, canonicalEan, 6);

  await page.getByRole('link', { name: 'Historique' }).click();
  const historyResponsePromise = waitForRequest(page, 'GET', '/api/history', (url) =>
    url.searchParams.get('ean13') === canonicalEan);
  await page.locator('#history-ean13').fill(canonicalEan);
  await page.getByRole('button', { name: 'Filtrer l’Historique', exact: true }).click();
  expect((await historyResponsePromise).status()).toBe(200);

  await expect(page.locator('#history-list .history-entry')).toHaveCount(2);
  await expect(page.locator(`[aria-labelledby="history-entry-${supplyReceipt.operation.id}"]`))
    .toContainText('Approvisionnement');
  await expect(page.locator(`[aria-labelledby="history-entry-${inventoryId}"]`))
    .toContainText('Inventaire');
});

test('presents every bulk Inventory line reconciliation on three Articles', async ({ page }) => {
  await openInventory(page);
  await page.locator('#inventory-add-line').click();
  await page.locator('#inventory-add-line').click();
  await page.locator('#inventory-ean13').fill(canonicalEan);
  await page.locator('#inventory-countedQuantity').fill('11');
  await page.locator('#inventory-ean13-1').fill('4567890123456');
  await page.locator('#inventory-countedQuantity-1').fill('5');
  await page.locator('#inventory-ean13-2').fill('5678901234562');
  await page.locator('#inventory-countedQuantity-2').fill('0');

  const responsePromise = waitForRequest(page, 'POST', '/api/inventories/bulk');
  await page.locator('#inventory-form button[type="submit"]').click();
  expect((await responsePromise).status()).toBe(201);

  const expectedLines = [
    { ean13: canonicalEan, previous: '5 unités', counted: '11 unités', difference: '+6', resulting: '11 unités', sellable: '11 unités', availability: 'Disponible' },
    { ean13: '4567890123456', previous: '8 unités', counted: '5 unités', difference: '-3', resulting: '5 unités', sellable: '5 unités', availability: 'Disponible' },
    { ean13: '5678901234562', previous: '0 unités', counted: '0 unités', difference: '0', resulting: '0 unités', sellable: '0 unités', availability: 'Rupture' },
  ];
  const receiptLines = result(page).locator('.inventory-result-line');
  await expect(receiptLines).toHaveCount(3);
  for (const [index, expected] of expectedLines.entries()) {
    const line = receiptLines.nth(index);
    const field = (label: string) => line.locator('dl > div').filter({ hasText: label }).locator('dd');
    await expect(field('EAN-13')).toHaveText(expected.ean13);
    await expect(field('Stock physique précédent')).toHaveText(expected.previous);
    await expect(field('Quantité comptée')).toHaveText(expected.counted);
    await expect(field('Écart d’inventaire')).toHaveText(expected.difference);
    await expect(field('Nouvelle base physique')).toHaveText(expected.resulting);
    await expect(field('Stock vendable')).toHaveText(expected.sellable);
    await expect(field('Disponibilité')).toHaveText(expected.availability);
  }
});

test('rejects an empty bulk Inventory without applying any state', async ({ page }) => {
  const stockBeforeResponse = await page.request.get(`${apiBaseUrl}/api/stock`);
  expect(stockBeforeResponse.status()).toBe(200);
  const stockBefore = await stockBeforeResponse.json();
  const historyBeforeResponse = await page.request.get(`${apiBaseUrl}/api/history`);
  expect(historyBeforeResponse.status()).toBe(200);
  const historyBefore = await historyBeforeResponse.json();

  const response = await page.request.post(`${apiBaseUrl}/api/inventories/bulk`, {
    data: { lines: [] },
  });
  await expectProblemDetails(response, { status: 400, code: 'INVALID_INPUT', fields: ['lines'] });

  const stockAfterResponse = await page.request.get(`${apiBaseUrl}/api/stock`);
  expect(stockAfterResponse.status()).toBe(200);
  await expect(stockAfterResponse.json()).resolves.toEqual(stockBefore);
  const historyAfterResponse = await page.request.get(`${apiBaseUrl}/api/history`);
  expect(historyAfterResponse.status()).toBe(200);
  await expect(historyAfterResponse.json()).resolves.toEqual(historyBefore);
});
