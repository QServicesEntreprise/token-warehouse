import { expect } from '@playwright/test';
import { test } from './fixtures';

test('searches, rejects an excessive quantity, commits a sale and reloads its result', async ({ page }) => {
  const salePanel = page.locator('#sale-panel');
  await page.goto('/');

  await salePanel.locator('#sale-search').fill('Article actif vendable');
  await salePanel.locator('#sale-search-form').getByRole('button', { name: 'Rechercher un Article', exact: true }).click();
  const row = salePanel.getByRole('row', { name: /4567890123456/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText('100 centimes');
  await expect(row).toContainText('8 unités');

  await row.getByRole('button', { name: 'Sélectionner Article actif vendable' }).click();
  await salePanel.locator('#sale-quantity').fill('9');
  const conflict = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/sales';
  });
  await salePanel.locator('#sale-submit').click();
  const conflictResponse = await conflict;
  expect(conflictResponse.status()).toBe(409);
  await expect(salePanel.locator('#sale-status')).toContainText('Stock vendable');
  await expect(salePanel.locator('#sale-quantity')).toHaveValue('9');

  await salePanel.locator('#sale-quantity').fill('3');
  const committed = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/sales';
  });
  await salePanel.locator('#sale-submit').click();
  const committedResponse = await committed;
  expect(committedResponse.status()).toBe(201);
  const receipt = await committedResponse.json() as {
    operation: { id: string; ean13: string; quantity: number };
    financial: { amountHtCents: number; vatCents: number; amountTtcCents: number };
    position: { physicalQuantity: number; sellableQuantity: number };
  };
  expect(receipt.operation.ean13).toBe('4567890123456');
  expect(receipt.operation.quantity).toBe(3);
  expect(receipt.financial.amountHtCents).toBe(300);
  expect(receipt.financial.vatCents).toBe(60);
  expect(receipt.financial.amountTtcCents).toBe(360);
  expect(receipt.position.physicalQuantity).toBe(5);
  expect(receipt.position.sellableQuantity).toBe(5);
  await expect(salePanel.locator('#sale-result')).toContainText('360');

  await page.reload();
  await expect(page.locator('#sale-result')).toContainText(receipt.operation.id);
  await expect(page.locator('#sale-result')).toContainText('360');
  await expect(page.locator('#sale-result')).toContainText('5 unités');
});

test('requires a food context, previews both rates and commits the selected mode', async ({ page }) => {
  const salePanel = page.locator('#sale-panel');
  await page.goto('/');

  await salePanel.locator('#sale-search').fill('0123456789012');
  await salePanel.locator('#sale-search-form').getByRole('button', { name: 'Rechercher un Article', exact: true }).click();
  const row = salePanel.getByRole('row', { name: /0123456789012/ });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Sélectionner Alimentaire aux deux modes' }).click();

  await expect(salePanel.locator('#sale-context input')).toHaveCount(2);
  await expect(salePanel.locator('#sale-pricing-preview')).toContainText('11/200');
  await expect(salePanel.locator('#sale-pricing-preview')).toContainText('1/10');

  await salePanel.locator('#sale-quantity').fill('1');
  await salePanel.locator('#sale-submit').click();
  await expect(salePanel.locator('#sale-status')).toContainText('Contexte de Vente');
  await expect(salePanel.locator('#sale-context input').first()).toBeFocused();
  await expect(salePanel.locator('#sale-quantity')).toHaveValue('1');

  await salePanel.getByLabel('À emporter', { exact: true }).check();
  const committed = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/sales';
  });
  await salePanel.locator('#sale-submit').click();
  const response = await committed;
  expect(response.status()).toBe(201);
  const receipt = await response.json() as {
    financial: { context: string; vatCents: number; amountTtcCents: number };
    position: { physicalQuantity: number; sellableQuantity: number };
  };
  expect(receipt.financial.context).toBe('takeaway');
  expect(receipt.financial.vatCents).toBe(6);
  expect(receipt.financial.amountTtcCents).toBe(106);
  expect(receipt.position.physicalQuantity).toBe(4);
  expect(receipt.position.sellableQuantity).toBe(4);
  await expect(salePanel.locator('#sale-result')).toContainText('11/200');
  await expect(salePanel.locator('#sale-result')).toContainText('106');

  await page.reload();
  await expect(salePanel.locator('#sale-context input')).toHaveCount(2);
  await expect(salePanel.locator('#sale-pricing-preview')).toContainText('11/200');
  await expect(salePanel.locator('#sale-pricing-preview')).toContainText('1/10');
});

test('keeps the draft when an Article is past its DLC', async ({ page }) => {
  const salePanel = page.locator('#sale-panel');
  await page.goto('/');

  await salePanel.locator('#sale-search').fill('Alimentaire à DLC dépassée');
  await salePanel.locator('#sale-search-form').getByRole('button', { name: 'Rechercher un Article', exact: true }).click();
  const row = salePanel.getByRole('row', { name: /1234567890128/ });
  await row.getByRole('button', { name: 'Sélectionner Alimentaire à DLC dépassée' }).click();
  await salePanel.locator('#sale-quantity').fill('1');

  const rejected = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/sales';
  });
  await salePanel.locator('#sale-submit').click();
  expect((await rejected).status()).toBe(409);
  await expect(salePanel.locator('#sale-status')).toContainText('ne peut pas être vendu');
  await expect(salePanel.locator('#sale-quantity')).toHaveValue('1');
  await expect(salePanel.locator('#sale-result')).toHaveCount(0);
});
