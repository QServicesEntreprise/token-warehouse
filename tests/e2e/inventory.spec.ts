import { expect, test } from '@playwright/test';

test('reconciles independent upper, lower, equal and zero counts through the real form', async ({ page }) => {
  const canonicalEan = '0123456789012';
  const lowerEan = '7351353713578';
  const zeroEan = '9876543210982';
  const archivedEan = '5012345678900';
  const unknownEan = '4006381333931';
  const timestamp = '2030-01-15T10:00:00+00:00';
  const result = page.locator('#inventory-result');
  const field = (label: string) => result.locator('dl > div').filter({ hasText: label }).locator('dd');

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

  const expectReceipt = async (expected: ExpectedReceipt) => {
    await expect(field('EAN-13')).toHaveText(expected.ean13);
    await expect(field('Stock physique précédent')).toHaveText(expected.previous + ' unités');
    await expect(field('Quantité comptée')).toHaveText(expected.counted + ' unités');
    await expect(field('Écart d’inventaire')).toHaveText(expected.difference);
    await expect(field('Nouvelle base physique')).toHaveText(expected.resulting + ' unités');
    await expect(field('Stock vendable')).toHaveText(expected.sellable + ' unités');
    await expect(field('Disponibilité')).toHaveText(expected.availability);
    await expect(field('Raison')).toHaveText(expected.reason);
    await expect(field('Timestamp UTC')).toHaveText(timestamp);
  };

  const submitInventory = async (ean13: string, countedQuantity: number) => {
    await page.locator('#inventory-ean13').fill(ean13);
    await page.locator('#inventory-countedQuantity').fill(String(countedQuantity));
    await page.getByRole('button', { name: 'Enregistrer l’Inventaire' }).click();
    await expect(result).toBeVisible();
  };

  const reloadAndExpect = async (expected: ExpectedReceipt) => {
    await page.reload();
    await expect(result).toBeVisible();
    await expectReceipt(expected);
  };

  const upper: ExpectedReceipt = {
    ean13: canonicalEan,
    previous: 8,
    counted: 11,
    difference: '+3',
    resulting: 11,
    sellable: 11,
    availability: 'Disponible',
    reason: '—',
  };
  const reset: ExpectedReceipt = {
    ...upper,
    previous: 11,
    counted: 8,
    difference: '-3',
    resulting: 8,
    sellable: 8,
  };
  const equal: ExpectedReceipt = {
    ...upper,
    previous: 8,
    counted: 8,
    difference: '0',
    resulting: 8,
    sellable: 8,
  };
  const lower: ExpectedReceipt = {
    ...upper,
    ean13: lowerEan,
    previous: 8,
    counted: 5,
    difference: '-3',
    resulting: 5,
    sellable: 5,
  };
  const zero: ExpectedReceipt = {
    ...upper,
    ean13: zeroEan,
    previous: 8,
    counted: 0,
    difference: '-8',
    resulting: 0,
    sellable: 0,
    availability: 'Rupture',
  };

  await page.goto('/');
  await expect(page.locator('#stock-table')).toBeVisible();
  await expect(
    page.locator('#stock-table').getByRole('row', { name: /DLC de démonstration/ }),
  ).toContainText('8 unités');

  await page.locator('#inventory-ean13').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#inventory-countedQuantity')).toBeFocused();

  await submitInventory(canonicalEan, upper.counted);
  await expectReceipt(upper);
  await reloadAndExpect(upper);

  await submitInventory(canonicalEan, reset.counted);
  await expectReceipt(reset);

  await submitInventory(canonicalEan, equal.counted);
  await expectReceipt(equal);
  await reloadAndExpect(equal);

  await submitInventory(lowerEan, lower.counted);
  await expectReceipt(lower);
  await reloadAndExpect(lower);

  await submitInventory(zeroEan, zero.counted);
  await expectReceipt(zero);
  await reloadAndExpect(zero);

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
  await expect(result).toHaveCount(0);

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
  await expect(page.locator('#inventory-error')).toContainText('introuvable');
  await expect(page.locator('#inventory-ean13')).toHaveValue(unknownEan);
  await expect(page.locator('#inventory-countedQuantity')).toHaveValue('6');
  await expect(page.locator('#inventory-countedQuantity')).toBeFocused();
  await expect(result).toHaveCount(0);

  await page.reload();
  await expect(result).toBeVisible();
  await expectReceipt(zero);
  await expect(
    page.locator('#stock-table').getByRole('row', { name: /Article vendable/ }),
  ).toContainText('0 unités');
  const stockAfterUnknown = await page.request.get(
    'http://127.0.0.1:5100/api/stock/' + zeroEan,
  );
  expect(stockAfterUnknown.status()).toBe(200);
  await expect(stockAfterUnknown.json()).resolves.toMatchObject({ physicalQuantity: 0 });

  const archived: ExpectedReceipt = {
    ...upper,
    ean13: archivedEan,
    previous: 4,
    counted: 2,
    difference: '-2',
    resulting: 2,
    sellable: 0,
    availability: 'Non vendable',
    reason: 'Article archivé',
  };
  await submitInventory(archivedEan, archived.counted);
  await expectReceipt(archived);
  await reloadAndExpect(archived);
});
