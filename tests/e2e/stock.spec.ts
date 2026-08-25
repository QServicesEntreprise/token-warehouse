import { expect, type Route } from '@playwright/test';
import type { StockPositionDto } from '../../src/web/features/stock/infrastructure/dto/stock-position.dto';
import { test } from './fixtures';
import { ean13ForAttempt, leadingZeroEan13 } from './helpers/ean13';
import { waitForRequest } from './helpers/http';
import { archive, createFoodArticle, createNonFoodArticle, supply } from './helpers/state';

test('recomputes sellable stock after food DLC and non-food packaging updates', async ({ page }) => {
  const foodEan = leadingZeroEan13;
  const nonFoodEan = '4567890123456';
  const today = '2030-01-15';
  const yesterday = '2030-01-14';
  const detailStock = (quantity: number) => page.locator('.article-detail').getByText(`${quantity} unités`, { exact: true });

  await page.goto(`/catalogue/${foodEan}`);
  await expect(page.getByRole('heading', { name: 'Alimentaire aux deux modes' })).toBeVisible();
  await page.locator('#detailDlc').fill(today);
  await page.getByRole('button', { name: 'Enregistrer les attributs' }).click();
  await expect(page.locator('#attribute-update-error')).toContainText('mis à jour');
  await expect(detailStock(5)).toHaveCount(2);

  await page.locator('#detailDlc').fill(yesterday);
  await page.getByRole('button', { name: 'Enregistrer les attributs' }).click();
  await expect(page.locator('#attribute-update-error')).toContainText('mis à jour');
  await expect(page.locator('.article-detail').getByText(yesterday, { exact: true })).toBeVisible();
  await expect(detailStock(5)).toHaveCount(1);
  await expect(detailStock(0)).toHaveCount(1);

  await page.goto(`/catalogue/${nonFoodEan}`);
  await expect(page.getByRole('heading', { name: 'Article actif vendable' })).toBeVisible();
  await page.locator('#detailPackaging').selectOption('new');
  await page.getByRole('button', { name: 'Enregistrer les attributs' }).click();
  await expect(page.locator('#attribute-update-error')).toContainText('mis à jour');
  await expect(detailStock(8)).toHaveCount(2);

  await page.locator('#detailPackaging').selectOption('unsellable');
  await page.getByRole('button', { name: 'Enregistrer les attributs' }).click();
  await expect(page.locator('#attribute-update-error')).toContainText('mis à jour');
  await expect(page.locator('.article-detail').getByText('unsellable', { exact: true })).toBeVisible();
  await expect(detailStock(8)).toHaveCount(1);
  await expect(detailStock(0)).toHaveCount(1);

  await page.reload();
  await expect(detailStock(8)).toHaveCount(1);
  await expect(detailStock(0)).toHaveCount(1);
});

test('consults Stock positions, distinguishes blocked quantities and opens detail by keyboard', async ({ page }) => {
  const stockPanel = page.locator('#stock-panel');

  await page.goto('/stock');
  await expect(stockPanel.getByText(/Articles trouvés/)).toBeVisible();
  await expect(stockPanel.getByRole('row', { name: /Alimentaire aux deux modes/ })).toContainText(leadingZeroEan13);
  await expect(stockPanel.getByRole('row', { name: /Alimentaire aux deux modes/ })).toContainText('5 unités');
  await expect(stockPanel.getByRole('row', { name: /Alimentaire à DLC dépassée/ })).toContainText('7 unités');
  await expect(stockPanel.getByRole('row', { name: /Alimentaire à DLC dépassée/ }).getByRole('cell', { name: '7 unités', exact: true })).toHaveCount(2);
  await expect(stockPanel.getByRole('row', { name: /Alimentaire à DLC dépassée/ })).toContainText('DLC dépassée');
  await expect(stockPanel.getByRole('row', { name: /Article archivé/ })).toContainText('4 unités');
  await expect(stockPanel.getByRole('row', { name: /Article archivé/ })).toContainText('Article archivé');
  await expect(stockPanel.getByRole('row', { name: /^Non alimentaire au Packaging Invendable / })).toContainText('3 unités');
  await expect(stockPanel.getByRole('row', { name: /^Non alimentaire au Packaging Invendable / })).toContainText('Packaging invendable');
  await expect(stockPanel.getByRole('row', { name: /Article actif sans position/ })).toContainText('0 unités');
  await expect(stockPanel.getByRole('row', { name: /Article actif sans position/ })).toContainText('Rupture');

  const expiredDetail = stockPanel.getByRole('button', { name: 'Consulter le détail du Stock de Alimentaire à DLC dépassée' });
  await expiredDetail.focus();
  await page.keyboard.press('Enter');
  await expect(stockPanel.getByRole('heading', { name: /Détail du Stock — Alimentaire à DLC dépassée/ })).toBeVisible();
  await expect(stockPanel.locator('#stock-detail')).toContainText('7 unités');
  await expect(stockPanel.locator('#stock-detail')).toContainText('0 unités');
  await expect(stockPanel.locator('#stock-detail')).toContainText('DLC dépassée');

  await page.reload();
  const reloadedStockPanel = page.locator('#stock-panel');
  await expect(reloadedStockPanel.getByRole('row', { name: /Alimentaire à DLC dépassée/ })).toContainText('DLC dépassée');
  const reloadedExpiredDetail = reloadedStockPanel.getByRole('button', { name: 'Consulter le détail du Stock de Alimentaire à DLC dépassée' });
  await reloadedExpiredDetail.focus();
  await page.keyboard.press('Enter');
  await expect(reloadedStockPanel.locator('#stock-detail')).toContainText('7 unités');
  await expect(reloadedStockPanel.locator('#stock-detail')).toContainText('DLC dépassée');
});

test('announces Stock loading, empty and error states', async ({ page }) => {
  const stockPanel = page.locator('#stock-panel');
  let releaseLoading: () => void = () => {};
  const loading = new Promise<void>((resolve) => {
    releaseLoading = resolve;
  });
  const stockRoute = /\/api\/stock$/;
  const delayedStockRoute = async (route: Route) => {
    await loading;
    await route.continue();
  };

  await page.route(stockRoute, delayedStockRoute);
  const navigation = page.goto('/stock');
  await expect(stockPanel.locator('#stock-state')).toContainText('Chargement du Stock');
  releaseLoading();
  await navigation;
  await expect(stockPanel.locator('#stock-state')).toContainText('Articles trouvés');
  await page.unroute(stockRoute, delayedStockRoute);

  let responseState: 'empty' | 'error' = 'empty';
  const stateRoute = async (route: Route) => {
    if (responseState === 'empty') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }

    await route.fulfill({
      status: 500,
      contentType: 'application/problem+json',
      body: JSON.stringify({ title: 'Le Stock est indisponible.', code: 'internal_error' }),
    });
  };
  await page.route(stockRoute, stateRoute);

  await page.reload();
  await expect(stockPanel.locator('#stock-state')).toContainText('Aucun Article');
  responseState = 'error';
  await page.reload();
  await expect(stockPanel.locator('#stock-state [role="alert"]')).toContainText('indisponible');
  await expect(stockPanel.locator('#stock-table')).toHaveCount(0);

  await page.unroute(stockRoute, stateRoute);
});

test.describe('Stock states prepared through public contracts', () => {
  test.use({ e2eSeed: 'empty' });

  test('shows Disponible with literal Stock physique and Stock vendable', async ({ page }) => {
    const article = await createNonFoodArticle(page, {
      ean13: ean13ForAttempt('660000001', 0),
      name: 'Article disponible',
      packaging: 'new',
      priceHtCents: 100,
    });
    await supply(page, article.ean13, 6);
    const stockResponse = waitForRequest(page, 'GET', '/api/stock');

    await page.goto('/stock');

    const position = ((await (await stockResponse).json()) as StockPositionDto[])
      .find((candidate) => candidate.ean13 === article.ean13);
    expect(position).toMatchObject({ physicalQuantity: 6, sellableQuantity: 6 });
    expect(position!.physicalQuantity - position!.sellableQuantity).toBe(0);
    const row = page.locator('#stock-panel').getByRole('row', { name: /Article disponible/ });
    await expect(row.getByRole('cell', { name: '6 unités', exact: true })).toHaveCount(2);
    await expect(row).toContainText('Disponible');
  });

  test('shows Rupture at 0 / 0 for an Article never supplied', async ({ page }) => {
    await createNonFoodArticle(page, {
      ean13: ean13ForAttempt('660000002', 0),
      name: 'Article sans position persistée',
      packaging: 'new',
      priceHtCents: 100,
    });

    await page.goto('/stock');

    const row = page.locator('#stock-panel').getByRole('row', { name: /Article sans position persistée/ });
    await expect(row.getByRole('cell', { name: '0 unités', exact: true })).toHaveCount(3);
    await expect(row).toContainText('Rupture');
  });

  test('shows Non vendable and distinguishes all three blocking reasons', async ({ page }) => {
    const packagingArticle = await createNonFoodArticle(page, {
      ean13: ean13ForAttempt('660000003', 0),
      name: 'Article au Packaging invendable',
      packaging: 'unsellable',
      priceHtCents: 100,
    });
    await supply(page, packagingArticle.ean13, 7);
    const expiredArticle = await createFoodArticle(page, {
      ean13: ean13ForAttempt('660000004', 0),
      name: 'Article à DLC dépassée',
      modes: ['takeaway'],
      dlc: '2030-01-14',
      priceHtCents: 100,
    });
    await supply(page, expiredArticle.ean13, 5);
    const archivedArticle = await createNonFoodArticle(page, {
      ean13: ean13ForAttempt('660000005', 0),
      name: 'Article archivé avec Stock',
      packaging: 'new',
      priceHtCents: 100,
    });
    await supply(page, archivedArticle.ean13, 4);
    await archive(page, archivedArticle.ean13);

    await page.goto('/stock');

    const stockPanel = page.locator('#stock-panel');
    const packagingRow = stockPanel.getByRole('row', { name: /Article au Packaging invendable/ });
    await expect(packagingRow).toContainText('7 unités');
    await expect(packagingRow).toContainText('0 unités');
    await expect(packagingRow).toContainText('Non vendable');
    await expect(packagingRow).toContainText('Packaging invendable');
    const expiredRow = stockPanel.getByRole('row', { name: /Article à DLC dépassée/ });
    await expect(expiredRow).toContainText('5 unités');
    await expect(expiredRow).toContainText('0 unités');
    await expect(expiredRow).toContainText('Non vendable');
    await expect(expiredRow).toContainText('DLC dépassée');
    const archivedRow = stockPanel.getByRole('row', { name: /Article archivé avec Stock/ });
    await expect(archivedRow).toContainText('4 unités');
    await expect(archivedRow).toContainText('0 unités');
    await expect(archivedRow).toContainText('Non vendable');
    await expect(archivedRow).toContainText('Article archivé');
  });

  test('reloads detail by EAN-13 and clears partial data when it fails', async ({ page }) => {
    const article = await createNonFoodArticle(page, {
      ean13: ean13ForAttempt('660000006', 0),
      name: 'Article détaillé',
      packaging: 'new',
      priceHtCents: 100,
    });
    await supply(page, article.ean13, 9);
    const listResponse = waitForRequest(page, 'GET', '/api/stock');

    await page.goto('/stock');

    const listed = ((await (await listResponse).json()) as StockPositionDto[])
      .find((position) => position.ean13 === article.ean13)!;
    const stockPanel = page.locator('#stock-panel');
    const row = stockPanel.getByRole('row', { name: /Article détaillé/ });
    await expect(row.getByRole('cell', { name: '9 unités', exact: true })).toHaveCount(2);
    const detailResponse = waitForRequest(page, 'GET', `/api/stock/${article.ean13}`);
    await row.getByRole('button', { name: /Consulter le détail/ }).click();
    const detail = (await (await detailResponse).json()) as StockPositionDto;
    expect([detail.physicalQuantity, detail.sellableQuantity])
      .toEqual([listed.physicalQuantity, listed.sellableQuantity]);
    const detailView = stockPanel.locator('#stock-detail');
    await expect(detailView.getByText('Stock physique', { exact: true }).locator('..')).toContainText('9 unités');
    await expect(detailView.getByText('Stock vendable', { exact: true }).locator('..')).toContainText('9 unités');

    const detailRoute = new RegExp(`/api/stock/${article.ean13}$`);
    const errorRoute = async (route: Route) => route.fulfill({
      status: 500,
      contentType: 'application/problem+json',
      body: JSON.stringify({ title: 'Le détail du Stock est indisponible.', code: 'internal_error' }),
    });
    await page.route(detailRoute, errorRoute);
    await row.getByRole('button', { name: /Consulter le détail/ }).click();
    await expect(stockPanel.locator('#stock-detail-error')).toContainText('indisponible');
    await expect(stockPanel.locator('#stock-detail')).toHaveCount(0);
    await page.unroute(detailRoute, errorRoute);
  });
});

const boundaryEan13 = ean13ForAttempt('660000007', 0);
for (const boundary of [
  { warehouseDate: '2030-01-15', sellableQuantity: 5, availability: 'Disponible', reason: '—' },
  { warehouseDate: '2030-01-16', sellableQuantity: 0, availability: 'Non vendable', reason: 'DLC dépassée' },
] as const) {
  test.describe(`DLC boundary on warehouse date ${boundary.warehouseDate}`, () => {
    test.use({ e2eSeed: 'empty', warehouseDate: boundary.warehouseDate });

    test('observes the same Article against the calendrier de l’Entrepôt', async ({ page }) => {
      const article = await createFoodArticle(page, {
        ean13: boundaryEan13,
        name: 'Article frontière DLC',
        modes: ['onsite'],
        dlc: '2030-01-15',
        priceHtCents: 100,
      });
      await supply(page, article.ean13, 5);

      await page.goto('/stock');

      const row = page.locator('#stock-panel').getByRole('row', { name: /Article frontière DLC/ });
      await expect(row).toContainText('5 unités');
      await expect(row).toContainText(`${boundary.sellableQuantity} unités`);
      await expect(row).toContainText(boundary.availability);
      await expect(row).toContainText(boundary.reason);
    });
  });
}

test('opens the Inventory prefilled from a Stock row', async ({ page }) => {
  await page.goto('/stock');
  await expect(page.locator('#stock-table')).toBeVisible();
  await page.getByRole('button', { name: /^Inventorier Alimentaire aux deux modes$/ }).click();

  await expect(page).toHaveURL(/\/stock\/inventaires\?ean13=/);
  await expect(page.locator('#inventory-ean13')).toHaveValue(leadingZeroEan13);
  await expect(page.locator('#inventory-countedQuantity')).toHaveValue('');
  await expect(page.locator('#inventory-form .inventory-line-hint'))
    .toContainText('Stock physique connu : 5 unités');
});
