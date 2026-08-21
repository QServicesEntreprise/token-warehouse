import { expect, test } from '@playwright/test';

test('records an inventory through the real form and keeps the new stock after reload', async ({ page }) => {
  await page.goto('/');

  await page.locator('#inventory-ean13').fill('7351353713578');
  await page.locator('#inventory-countedQuantity').fill('11');
  await page.getByRole('button', { name: 'Enregistrer l’Inventaire' }).click();

  const result = page.locator('#inventory-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('Stock physique précédent');
  await expect(result).toContainText('8 unités');
  await expect(result).toContainText('Quantité comptée');
  await expect(result).toContainText('11 unités');
  await expect(result).toContainText('+3');
  await expect(result).toContainText('Nouvelle base physique');
  await expect(result).toContainText('2030-01-15T10:00:00+00:00');

  await page.reload();
  const stockRow = page.locator('#stock-table').getByRole('row', { name: /Inventaire de démonstration/ });
  await expect(stockRow).toContainText('11 unités');
});
