import { expect } from '@playwright/test';
import { test } from './fixtures';
import type { SaleResponse } from '../../src/web/app/sales-api.service';
import { ean13ForAttempt, leadingZeroEan13 } from './helpers/ean13';
import { waitForRequest } from './helpers/http';
import {
  apiBaseUrl,
  archive,
  createFoodArticle,
  createNonFoodArticle,
  reactivate,
  sell,
  supply,
} from './helpers/state';

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
  const conflict = waitForRequest(page, 'POST', '/api/sales');
  await salePanel.locator('#sale-submit').click();
  const conflictResponse = await conflict;
  expect(conflictResponse.status()).toBe(409);
  await expect(salePanel.locator('#sale-status')).toContainText('Stock vendable');
  await expect(salePanel.locator('#sale-quantity')).toHaveValue('9');

  await salePanel.locator('#sale-quantity').fill('3');
  const committed = waitForRequest(page, 'POST', '/api/sales');
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

  await salePanel.locator('#sale-search').fill(leadingZeroEan13);
  await salePanel.locator('#sale-search-form').getByRole('button', { name: 'Rechercher un Article', exact: true }).click();
  const row = salePanel.getByRole('row', { name: new RegExp(leadingZeroEan13) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('À emporter : 106 centimes');
  await expect(row).toContainText('Sur place : 110 centimes');
  await row.getByRole('button', { name: 'Sélectionner Alimentaire aux deux modes' }).click();

  await expect(salePanel.locator('#sale-context input')).toHaveCount(2);
  await expect(salePanel.locator('#sale-pricing-preview')).toContainText('11/200');
  await expect(salePanel.locator('#sale-pricing-preview')).toContainText('1/10');

  await salePanel.locator('#sale-quantity').fill('3');
  await salePanel.locator('#sale-submit').click();
  await expect(salePanel.locator('#sale-status')).toContainText('Contexte de Vente');
  await expect(salePanel.locator('#sale-context input').first()).toBeFocused();
  await expect(salePanel.locator('#sale-quantity')).toHaveValue('3');

  await salePanel.getByLabel('Sur place', { exact: true }).check();
  const committed = waitForRequest(page, 'POST', '/api/sales');
  await salePanel.locator('#sale-submit').click();
  const response = await committed;
  expect(response.status()).toBe(201);
  const receipt = await response.json() as {
    financial: { context: string; vatCents: number; amountTtcCents: number };
    position: { physicalQuantity: number; sellableQuantity: number };
  };
  expect(receipt.financial.context).toBe('onsite');
  expect(receipt.financial.vatCents).toBe(30);
  expect(receipt.financial.amountTtcCents).toBe(330);
  expect(receipt.position.physicalQuantity).toBe(2);
  expect(receipt.position.sellableQuantity).toBe(2);
  await expect(salePanel.locator('#sale-result')).toContainText('1/10');
  await expect(salePanel.locator('#sale-result')).toContainText('330');

  await page.reload();
  await expect(salePanel.locator('#sale-context input')).toHaveCount(2);
  await expect(salePanel.locator('#sale-pricing-preview')).toContainText('11/200');
  await expect(salePanel.locator('#sale-pricing-preview')).toContainText('1/10');
});

test.describe('Sale context, receipt and financial snapshot', () => {
  test.use({ e2eSeed: 'empty' });

  test('deduces the single food mode without offering a choice and exposes the ten receipt values', async ({ page }) => {
    const ean13 = ean13ForAttempt('700000007', 0);
    const name = 'Article alimentaire au mode unique';
    await createFoodArticle(page, {
      ean13,
      name,
      modes: ['onsite'],
      dlc: '2030-01-20',
      priceHtCents: 101,
    });
    await supply(page, ean13, 4);
    const salePanel = page.locator('#sale-panel');
    await page.goto('/');
    await salePanel.locator('#sale-search').fill(ean13);
    await salePanel.locator('#sale-search-form').getByRole('button', { name: 'Rechercher un Article', exact: true }).click();
    await salePanel.getByRole('row', { name: new RegExp(ean13) })
      .getByRole('button', { name: `Sélectionner ${name}` })
      .click();

    await expect(salePanel.locator('#sale-context input')).toHaveCount(0);
    await expect(salePanel.locator('#sale-context-derived')).toHaveText('Contexte déduit : Sur place.');
    await expect(salePanel.locator('#sale-pricing-preview')).toContainText('1/10');
    await salePanel.locator('#sale-quantity').fill('3');
    const committed = waitForRequest(page, 'POST', '/api/sales');
    await salePanel.locator('#sale-submit').click();
    const response = await committed;
    expect(response.status()).toBe(201);
    const sale = await response.json() as SaleResponse;
    expect(sale.financial).toMatchObject({
      context: 'onsite',
      unitPriceHtCents: 101,
      taxRate: { ratio: '1/10' },
      amountHtCents: 303,
      vatCents: 30,
      amountTtcCents: 333,
    });

    const receipt = salePanel.locator('#sale-result');
    const field = (label: string) => receipt.getByText(label, { exact: true })
      .locator('xpath=following-sibling::dd');
    await expect(field('Identifiant d’opération')).toHaveText(sale.operation.id);
    await expect(field('Horodatage UTC')).toHaveText('2030-01-15T10:00:00+00:00');
    await expect(field('EAN-13')).toHaveText(ean13);
    await expect(field('Quantité')).toHaveText('3 unités');
    await expect(field('Prix HT unitaire')).toHaveText('101 centimes');
    await expect(field('Taux de TVA')).toHaveText('1/10');
    await expect(field('Montant HT')).toHaveText('303 centimes');
    await expect(field('TVA')).toHaveText('30 centimes');
    await expect(field('Montant TTC')).toHaveText('333 centimes');
    await expect(field('Stock physique résultant')).toHaveText('1 unités');
  });

  test('keeps Sale amounts immutable after price, DLC, Packaging, archive and reactivation mutations', async ({ page }) => {
    const foodEan13 = ean13ForAttempt('700000008', 0);
    const nonFoodEan13 = ean13ForAttempt('700000009', 0);
    await createFoodArticle(page, {
      ean13: foodEan13,
      modes: ['takeaway'],
      dlc: '2030-01-20',
      priceHtCents: 101,
    });
    await createNonFoodArticle(page, {
      ean13: nonFoodEan13,
      packaging: 'new',
      priceHtCents: 101,
    });
    await supply(page, foodEan13, 4);
    await supply(page, nonFoodEan13, 4);
    const foodSale = await sell(page, foodEan13, 2, 'takeaway');
    const nonFoodSale = await sell(page, nonFoodEan13, 3);
    const foodFinancial = {
      context: 'takeaway',
      unitPriceHtCents: 101,
      taxRate: { ratio: '11/200' },
      amountHtCents: 202,
      vatCents: 11,
      amountTtcCents: 213,
    };
    const nonFoodFinancial = {
      context: null,
      unitPriceHtCents: 101,
      taxRate: { ratio: '1/5' },
      amountHtCents: 303,
      vatCents: 61,
      amountTtcCents: 364,
    };
    const expectStoredFinancial = async (operationId: string, financial: object) => {
      const response = await page.request.get(`${apiBaseUrl}/api/sales/${operationId}`);
      await expect(response).toBeOK();
      await expect(response.json()).resolves.toMatchObject({ financial });
    };

    const priceUpdate = await page.request.patch(`${apiBaseUrl}/api/articles/${foodEan13}`, {
      data: { priceHtCents: 202 },
    });
    await expect(priceUpdate).toBeOK();
    await expectStoredFinancial(foodSale.operation.id, foodFinancial);

    const dlcUpdate = await page.request.patch(`${apiBaseUrl}/api/articles/${foodEan13}`, {
      data: { dlc: '2030-01-21' },
    });
    await expect(dlcUpdate).toBeOK();
    await expectStoredFinancial(foodSale.operation.id, foodFinancial);

    await archive(page, foodEan13);
    await expectStoredFinancial(foodSale.operation.id, foodFinancial);
    await reactivate(page, foodEan13);
    await expectStoredFinancial(foodSale.operation.id, foodFinancial);

    const packagingUpdate = await page.request.patch(`${apiBaseUrl}/api/articles/${nonFoodEan13}`, {
      data: { packaging: 'refurbished' },
    });
    await expect(packagingUpdate).toBeOK();
    await expectStoredFinancial(nonFoodSale.operation.id, nonFoodFinancial);
  });
});
