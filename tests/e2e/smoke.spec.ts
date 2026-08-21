import { expect, test } from '@playwright/test';

test('searches and filters the catalogue, including an archived detail', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Créer et consulter un Article' })).toBeVisible();
  await expect(page.getByText('Aucun Article ne correspond à ces critères.')).toBeVisible();

  await page.locator('#catalog-status').selectOption('archived');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.getByRole('row', { name: /Biscuit historique/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Lampe historique/ })).toBeVisible();
  await page.getByRole('button', { name: 'Consulter Biscuit historique' }).click();
  await expect(page.getByRole('heading', { name: 'Biscuit historique' })).toBeVisible();
  await expect(page.locator('section[aria-labelledby="lookup-title"]').getByText('Archivé')).toBeVisible();

  await page.locator('#catalog-status').selectOption('all');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.getByRole('row', { name: /Biscuit historique/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Lampe historique/ })).toBeVisible();

  await page.locator('#catalog-status').selectOption('active');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();

  await page.locator('#ean13').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#type')).toBeFocused();

  await page.locator('#ean13').fill('0123456789012');
  await page.locator('#name').fill('Chocolat noir');
  await page.locator('#priceHtCents').fill('199');
  await page.locator('#dlc').fill('2026-12-31');
  await page.locator('#consumptionModes').getByLabel('À emporter').check();
  await page.locator('#consumptionModes').getByLabel('Sur place').check();
  await page.getByRole('button', { name: 'Créer l’Article' }).click();

  await expect(page.getByRole('heading', { name: 'Chocolat noir' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Chocolat noir/ })).toBeVisible();

  await page.locator('#catalog-search').fill('chocolat');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.getByRole('row', { name: /Chocolat noir/ })).toBeVisible();

  await page.locator('#catalog-search').fill('0123456789012');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.getByRole('row', { name: /0123456789012/ })).toBeVisible();

  await page.locator('#catalog-search').fill('aucune référence');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.getByText('Aucun Article ne correspond à ces critères.')).toBeVisible();

  await page.locator('#catalog-search').fill('');
  await page.locator('#catalog-type').selectOption('food');
  await page.locator('#catalog-mode').selectOption('onsite');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.getByRole('row', { name: /Chocolat noir/ })).toBeVisible();

  await page.locator('#type').selectOption('nonFood');
  await expect(page.locator('#dlc')).toHaveCount(0);
  await expect(page.locator('#consumptionModes')).toHaveCount(0);
  await page.locator('#priceHtCents').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#packaging')).toBeFocused();
  await page.locator('#ean13').fill('4006381333931');
  await page.locator('#name').fill('Batterie reconditionnée');
  await page.locator('#priceHtCents').fill('2500');
  await page.locator('#packaging').selectOption('refurbished');
  await page.getByRole('button', { name: 'Créer l’Article' }).click();
  await expect(page.getByRole('heading', { name: 'Batterie reconditionnée' })).toBeVisible();

  await page.locator('#catalog-type').selectOption('nonFood');
  await page.locator('#catalog-packaging').selectOption('refurbished');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.getByRole('row', { name: /Batterie reconditionnée/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Lampe historique/ })).toHaveCount(0);

  await page.reload();
  await page.locator('#lookupEan13').fill('0123456789012');
  await page.getByRole('button', { name: 'Consulter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Chocolat noir' })).toBeVisible();
  await expect(page.getByText('2026-12-31')).toBeVisible();

  await page.locator('#type').selectOption('food');
  await page.locator('#ean13').fill('0123456789013');
  await page.locator('#name').fill('EAN invalide');
  await page.locator('#priceHtCents').fill('100');
  await page.locator('#dlc').fill('2026-12-31');
  await page.locator('#consumptionModes').getByLabel('À emporter').check();
  await page.getByRole('button', { name: 'Créer l’Article' }).click();
  await expect(page.locator('#ean13-error')).toContainText('checksum');
  await expect(page.locator('#ean13')).toBeFocused();

  await page.locator('#type').selectOption('nonFood');
  await page.locator('#ean13').fill('4006381333931');
  await page.locator('#name').fill('Doublon');
  await page.locator('#priceHtCents').fill('2500');
  await page.locator('#packaging').selectOption('refurbished');
  await page.getByRole('button', { name: 'Créer l’Article' }).click();
  await expect(page.locator('#ean13-error')).toContainText('déjà');
  await expect(page.locator('#ean13')).toBeFocused();

  await page.screenshot({ path: 'artifacts/playwright/catalogue.png', fullPage: true });
});
