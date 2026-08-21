import { expect, test } from '@playwright/test';

test('reconciles upper, lower, equal and zero counts through the real form', async ({ page }) => {
  const inventoryEan = '7351353713578';
  const archivedEan = '5012345678900';
  const unknownEan = '4006381333931';
  const result = page.locator('#inventory-result');
  const field = (label: string) => result.locator('dl > div').filter({ hasText: label }).locator('dd');
  const submitInventory = async (ean13: string, countedQuantity: number) => {
    await page.locator('#inventory-ean13').fill(ean13);
    await page.locator('#inventory-countedQuantity').fill(String(countedQuantity));
    await page.getByRole('button', { name: 'Enregistrer l’Inventaire' }).click();
    await expect(result).toBeVisible();
  };

  await page.goto('/');
  await expect(page.locator('#stock-table')).toBeVisible();

  await page.locator('#inventory-ean13').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#inventory-countedQuantity')).toBeFocused();

  await submitInventory(inventoryEan, 11);
  await expect(field('Stock physique précédent')).toHaveText('8 unités');
  await expect(field('Quantité comptée')).toHaveText('11 unités');
  await expect(field('Écart d’inventaire')).toHaveText('+3');
  await expect(field('Nouvelle base physique')).toHaveText('11 unités');
  await expect(field('Timestamp UTC')).toHaveText('2030-01-15T10:00:00+00:00');

  await page.reload();
  await expect(result).toBeVisible();
  await expect(field('Écart d’inventaire')).toHaveText('+3');
  await expect(field('Timestamp UTC')).toHaveText('2030-01-15T10:00:00+00:00');

  await submitInventory(inventoryEan, 5);
  await expect(field('Stock physique précédent')).toHaveText('11 unités');
  await expect(field('Écart d’inventaire')).toHaveText('-6');
  await expect(field('Nouvelle base physique')).toHaveText('5 unités');

  await submitInventory(inventoryEan, 5);
  await expect(field('Stock physique précédent')).toHaveText('5 unités');
  await expect(field('Écart d’inventaire')).toHaveText('0');
  await expect(field('Nouvelle base physique')).toHaveText('5 unités');

  await page.reload();
  await expect(result).toBeVisible();
  await expect(field('Écart d’inventaire')).toHaveText('0');
  await expect(field('Timestamp UTC')).toHaveText('2030-01-15T10:00:00+00:00');

  await submitInventory(inventoryEan, 0);
  await expect(field('Quantité comptée')).toHaveText('0 unités');
  await expect(field('Écart d’inventaire')).toHaveText('-5');
  await expect(field('Nouvelle base physique')).toHaveText('0 unités');

  let invalidPostCount = 0;
  const invalidPostListener = (request: import('@playwright/test').Request) => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname === '/api/inventories') {
      invalidPostCount += 1;
    }
  };
  page.on('request', invalidPostListener);
  await page.locator('#inventory-ean13').fill(inventoryEan);
  await page.locator('#inventory-countedQuantity').fill('-1');
  await page.locator('#inventory-countedQuantity').press('Enter');
  page.off('request', invalidPostListener);
  expect(invalidPostCount).toBe(0);
  await expect(page.locator('#inventory-countedQuantity-error')).toContainText('entier');
  await expect(page.locator('#inventory-ean13')).toHaveValue(inventoryEan);
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
  await expect(
    page.locator('#stock-table').getByRole('row', { name: /Inventaire de démonstration/ }),
  ).toContainText('0 unités');
  const stockAfterUnknown = await page.request.get(
    `http://127.0.0.1:5100/api/stock/${inventoryEan}`,
  );
  expect(stockAfterUnknown.status()).toBe(200);
  await expect(stockAfterUnknown.json()).resolves.toMatchObject({ physicalQuantity: 0 });

  await submitInventory(archivedEan, 2);
  await expect(field('Stock physique précédent')).toHaveText('4 unités');
  await expect(field('Quantité comptée')).toHaveText('2 unités');
  await expect(field('Écart d’inventaire')).toHaveText('-2');
  await expect(field('Nouvelle base physique')).toHaveText('2 unités');
  await expect(field('Stock vendable')).toHaveText('0 unités');
  await expect(result).toContainText('Article archivé');
});
