import { expect } from '@playwright/test';
import { test } from './fixtures';
import type { Page, Route } from '@playwright/test';

const canonicalEan = '0123456789012';
const archivedEan = '5012345678900';
const unknownEan = '4006381333931';
const timestamp = '2030-01-15T10:00:00+00:00';
const apiBaseUrl = 'http://127.0.0.1:5100';

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
  await page.goto('/');
  await expect(page.locator('#stock-table')).toBeVisible();
  await expect(
    page.locator('#stock-table').getByRole('row', { name: /DLC de démonstration/ }),
  ).toContainText('8 unités');
  await page.locator('#inventory-ean13').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#inventory-countedQuantity')).toBeFocused();
};

const submitInventory = async (
  page: Page,
  ean13: string,
  countedQuantity: number,
) => {
  const submitButton = page.locator('#inventory-form button[type="submit"]');
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/inventories';
  });
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

test('reconciles the canonical stock from 8 to 11 with a positive difference', async ({ page }) => {
  await expectIndependentReceipt(page, {
    ean13: canonicalEan,
    previous: 8,
    counted: 11,
    difference: '+3',
    resulting: 11,
    sellable: 11,
    availability: 'Disponible',
    reason: '—',
  });
});

test('reconciles the canonical stock from 8 to 5 with a negative difference', async ({ page }) => {
  await expectIndependentReceipt(page, {
    ean13: canonicalEan,
    previous: 8,
    counted: 5,
    difference: '-3',
    resulting: 5,
    sellable: 5,
    availability: 'Disponible',
    reason: '—',
  });
});

test('keeps an equal canonical count as a visible zero-difference fact', async ({ page }) => {
  await expectIndependentReceipt(page, {
    ean13: canonicalEan,
    previous: 8,
    counted: 8,
    difference: '0',
    resulting: 8,
    sellable: 8,
    availability: 'Disponible',
    reason: '—',
  });
});

test('accepts a zero canonical count and establishes an empty position', async ({ page }) => {
  await expectIndependentReceipt(page, {
    ean13: canonicalEan,
    previous: 8,
    counted: 0,
    difference: '-8',
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
  const unknownResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/inventories';
  });
  await page.locator('#inventory-countedQuantity').press('Enter');
  const unknownResponse = await unknownResponsePromise;
  expect(unknownResponse.status()).toBe(404);
  expect(unknownResponse.headers()['content-type']).toContain('application/problem+json');
  await expect(unknownResponse.json()).resolves.toMatchObject({
    status: 404,
    code: 'ARTICLE_NOT_FOUND',
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
