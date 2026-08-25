import { expect, type Page } from '@playwright/test';
import type { HistoryEntryDto } from '../../src/web/features/stock/infrastructure/dto/history-entry.dto';
import type { SaleResult } from '../../src/web/features/sales/domain/sale-result';
import type { StockPositionDto } from '../../src/web/features/stock/infrastructure/dto/stock-position.dto';
import { test } from './fixtures';
import { ean13ForAttempt } from './helpers/ean13';
import { expectProblemDetails, waitForRequest } from './helpers/http';
import {
  apiBaseUrl,
  archive,
  createFoodArticle,
  createNonFoodArticle,
  supply,
} from './helpers/state';

type SalePayload = {
  ean13: string;
  quantity: number;
  context?: 'takeaway' | 'onsite';
};

const readStockAndHistory = async (page: Page, ean13: string) => {
  const [stockResponse, historyResponse] = await Promise.all([
    page.request.get(`${apiBaseUrl}/api/stock/${ean13}`),
    page.request.get(`${apiBaseUrl}/api/history?ean13=${ean13}`),
  ]);
  await expect(stockResponse).toBeOK();
  await expect(historyResponse).toBeOK();
  return {
    stock: await stockResponse.json() as StockPositionDto,
    history: await historyResponse.json() as HistoryEntryDto[],
  };
};

const expectRejectedWithoutMutation = async (
  page: Page,
  payload: SalePayload,
  expected: { code: string; field: string },
) => {
  const before = await readStockAndHistory(page, payload.ean13);
  const response = await page.request.post(`${apiBaseUrl}/api/sales`, { data: payload });
  await expectProblemDetails(response, { status: 409, code: expected.code, fields: [expected.field] });
  expect(await readStockAndHistory(page, payload.ean13)).toEqual(before);
};

test.describe('Sale refusal invariants', () => {
  test.use({ e2eSeed: 'empty' });

  test('refuses an archived Article, leaves Stock and History unchanged, and keeps it in the archived Catalogue', async ({ page }) => {
    const ean13 = ean13ForAttempt('700000001', 0);
    await createFoodArticle(page, {
      ean13,
      name: 'Article archivé pour Vente',
      modes: ['takeaway'],
      dlc: '2030-01-20',
      priceHtCents: 101,
    });
    await supply(page, ean13, 4);
    await archive(page, ean13);

    const saleSearch = await page.request.get(`${apiBaseUrl}/api/sales/articles?search=${ean13}`);
    await expect(saleSearch).toBeOK();
    await expect(saleSearch.json()).resolves.toEqual([]);

    await page.goto('/catalogue');
    await page.locator('#catalog-status').selectOption('archived');
    await page.locator('#catalog-search').fill(ean13);
    await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
    const archivedRow = page.locator('section[aria-labelledby="catalog-title"]')
      .getByRole('row', { name: new RegExp(ean13) });
    await expect(archivedRow).toBeVisible();
    await expect(archivedRow).toContainText('Archivé');

    await expectRejectedWithoutMutation(
      page,
      { ean13, quantity: 1 },
      { code: 'NOT_SELLABLE', field: 'ean13' },
    );
  });

  test('refuses an Article with Invendable Packaging without moving its physical Stock or History', async ({ page }) => {
    const ean13 = ean13ForAttempt('700000002', 0);
    await createNonFoodArticle(page, {
      ean13,
      packaging: 'unsellable',
      priceHtCents: 101,
    });
    await supply(page, ean13, 4);

    await expectRejectedWithoutMutation(
      page,
      { ean13, quantity: 1 },
      { code: 'NOT_SELLABLE', field: 'ean13' },
    );
  });

  test('refuses an Article past its DLC, keeps the draft, physical Stock and History unchanged', async ({ page }) => {
    const ean13 = ean13ForAttempt('700000003', 0);
    const name = 'Article alimentaire à DLC dépassée';
    await createFoodArticle(page, {
      ean13,
      name,
      modes: ['takeaway'],
      dlc: '2030-01-14',
      priceHtCents: 101,
    });
    await supply(page, ean13, 4);
    const before = await readStockAndHistory(page, ean13);
    const salePanel = page.locator('#sale-panel');
    await page.goto('/ventes');
    await salePanel.locator('#sale-search').fill(ean13);
    await salePanel.locator('#sale-search-form').getByRole('button', { name: 'Rechercher un Article', exact: true }).click();
    await salePanel.getByRole('row', { name: new RegExp(ean13) })
      .getByRole('button', { name: `Sélectionner ${name}` })
      .click();
    await salePanel.locator('#sale-quantity').fill('1');

    const rejected = waitForRequest(page, 'POST', '/api/sales');
    await salePanel.locator('#sale-submit').click();
    await expectProblemDetails(await rejected, { status: 409, code: 'NOT_SELLABLE', fields: ['ean13'] });
    await expect(salePanel.locator('#sale-status')).toContainText('ne peut pas être vendu');
    await expect(salePanel.locator('#sale-quantity')).toHaveValue('1');
    await expect(salePanel.locator('#sale-result')).toHaveCount(0);
    expect(await readStockAndHistory(page, ean13)).toEqual(before);
  });

  test('refuses a context not declared by the food Article without moving Stock or History', async ({ page }) => {
    const ean13 = ean13ForAttempt('700000004', 0);
    await createFoodArticle(page, {
      ean13,
      modes: ['takeaway'],
      dlc: '2030-01-20',
      priceHtCents: 101,
    });
    await supply(page, ean13, 4);

    await expectRejectedWithoutMutation(
      page,
      { ean13, quantity: 1, context: 'onsite' },
      { code: 'CONTEXT_INCOMPATIBLE', field: 'context' },
    );
  });

  test('refuses a context on a non-food Article, then sells it at 20% without asking for one', async ({ page }) => {
    const ean13 = ean13ForAttempt('700000005', 0);
    await createNonFoodArticle(page, {
      ean13,
      name: 'Article non alimentaire vendu sans contexte',
      packaging: 'new',
      priceHtCents: 101,
    });
    await supply(page, ean13, 4);

    const articlesResponse = await page.request.get(`${apiBaseUrl}/api/sales/articles?search=${ean13}`);
    await expect(articlesResponse).toBeOK();
    await expect(articlesResponse.json()).resolves.toEqual([
      expect.objectContaining({
        ean13,
        priceHtCents: 101,
        physicalQuantity: 4,
        sellableQuantity: 4,
        availability: 'AVAILABLE',
        priceQuotes: [expect.objectContaining({ priceTtcCents: 121 })],
      }),
    ]);
    const salePanel = page.locator('#sale-panel');
    await page.goto('/ventes');
    await salePanel.locator('#sale-search').fill(ean13);
    await salePanel.locator('#sale-search-form').getByRole('button', { name: 'Rechercher un Article', exact: true }).click();
    const row = salePanel.getByRole('row', { name: new RegExp(ean13) });
    await expect(row).toContainText(/1,01\s€/);
    await expect(row).toContainText('4 unités');
    await expect(row).toContainText('Disponible');
    await expect(row).toContainText(/1,21\s€/);
    await row.getByRole('button', { name: 'Sélectionner Article non alimentaire vendu sans contexte' }).click();
    await expect(salePanel.locator('#sale-context input')).toHaveCount(0);
    await expect(salePanel.locator('#sale-context-none')).toHaveText('Aucun Contexte de Vente — TVA non alimentaire.');
    await expect(salePanel.locator('#sale-pricing-preview')).toContainText('1/5');
    await expect(salePanel.locator('#sale-pricing-preview')).toContainText(/1,21\s€/);

    await expectRejectedWithoutMutation(
      page,
      { ean13, quantity: 1, context: 'takeaway' },
      { code: 'CONTEXT_NOT_ALLOWED', field: 'context' },
    );

    await salePanel.locator('#sale-quantity').fill('3');
    const committed = waitForRequest(page, 'POST', '/api/sales');
    await salePanel.locator('#sale-submit').click();
    const response = await committed;
    expect(response.status()).toBe(201);
    await expect(response.json() as Promise<SaleResult>).resolves.toMatchObject({
      operation: { ean13, quantity: 3 },
      financial: {
        context: null,
        unitPriceHtCents: 101,
        taxRate: { ratio: '1/5' },
        amountHtCents: 303,
        vatCents: 61,
        amountTtcCents: 364,
      },
      position: { physicalQuantity: 1, sellableQuantity: 1 },
    });
  });
});

test.describe('Sale optimistic concurrency', () => {
  test.use({ e2eSeed: 'empty', saleCommitGateEnabled: true });

  test('refuses the Sale after its validated Stock position changes without adding another movement', async ({
    page,
    saleCommitGate,
  }) => {
    const ean13 = ean13ForAttempt('700000006', 0);
    await createNonFoodArticle(page, {
      ean13,
      packaging: 'new',
      priceHtCents: 101,
    });
    await supply(page, ean13, 4);

    const sale = page.request.post(`${apiBaseUrl}/api/sales`, {
      data: { ean13, quantity: 1 },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await saleCommitGate.waitUntilValidated();
    await supply(page, ean13, 2);
    const afterConcurrentMovement = await readStockAndHistory(page, ean13);
    saleCommitGate.release();

    await expectProblemDetails(await sale, {
      status: 409,
      code: 'POSITION_CONFLICT',
      fields: ['ean13'],
    });
    expect(await readStockAndHistory(page, ean13)).toEqual(afterConcurrentMovement);
  });
});
