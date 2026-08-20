import { expect, test } from '@playwright/test';

test('creates and consults food and non-food articles through the real UI', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Créer et consulter un Article' })).toBeVisible();
  await page.locator('#ean13').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#type')).toBeFocused();

  await page.locator('#ean13').fill('0123456789012');
  await page.locator('#name').fill('Chocolat noir');
  await page.locator('#priceHtCents').fill('199');
  await page.locator('#dlc').fill('2026-12-31');
  await page.getByLabel('À emporter').check();
  await page.getByLabel('Sur place').check();
  await page.getByRole('button', { name: 'Créer l’Article' }).click();

  await expect(page.getByRole('heading', { name: 'Chocolat noir' })).toBeVisible();
  await expect(page.getByText('0123456789012')).toBeVisible();
  await expect(page.getByText('199 centimes')).toBeVisible();
  await expect(page.getByText('takeaway, onsite')).toBeVisible();

  await page.reload();
  await page.locator('#lookupEan13').fill('0123456789012');
  await page.getByRole('button', { name: 'Consulter' }).click();
  await expect(page.getByRole('heading', { name: 'Chocolat noir' })).toBeVisible();
  await expect(page.getByText('2026-12-31')).toBeVisible();

  await page.locator('#type').selectOption('nonFood');
  await expect(page.locator('#dlc')).toHaveCount(0);
  await expect(page.locator('#consumptionModes')).toHaveCount(0);
  await page.locator('#priceHtCents').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#packaging')).toBeFocused();
  await page.locator('#ean13').fill('4006381333931');
  await page.locator('#name').fill('Batterie');
  await page.locator('#priceHtCents').fill('2500');
  await page.locator('#packaging').selectOption('refurbished');
  await page.getByRole('button', { name: 'Créer l’Article' }).click();
  await expect(page.getByRole('heading', { name: 'Batterie' })).toBeVisible();
  await expect(page.getByText('refurbished')).toBeVisible();

  await page.reload();
  await page.locator('#lookupEan13').fill('4006381333931');
  await page.getByRole('button', { name: 'Consulter' }).click();
  await expect(page.getByRole('heading', { name: 'Batterie' })).toBeVisible();
  await expect(page.getByText('2500 centimes')).toBeVisible();
  await expect(page.getByText('refurbished')).toBeVisible();

  await page.locator('#type').selectOption('food');
  await page.locator('#ean13').fill('0123456789013');
  await page.locator('#name').fill('EAN invalide');
  await page.locator('#priceHtCents').fill('100');
  await page.locator('#dlc').fill('2026-12-31');
  await page.getByLabel('À emporter').check();
  await page.getByRole('button', { name: 'Créer l’Article' }).click();
  await expect(page.locator('#ean13-error')).toContainText('checksum');

  await page.locator('#type').selectOption('nonFood');
  await page.locator('#ean13').fill('4006381333931');
  await page.locator('#name').fill('Doublon');
  await page.locator('#priceHtCents').fill('2500');
  await page.locator('#packaging').selectOption('refurbished');
  await page.getByRole('button', { name: 'Créer l’Article' }).click();
  await expect(page.locator('#ean13-error')).toContainText('déjà');

  await page.screenshot({ path: 'artifacts/playwright/shell.png', fullPage: true });
});
