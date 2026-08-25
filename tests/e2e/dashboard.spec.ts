import { expect } from '@playwright/test';
import type { Route } from '@playwright/test';
import { apiUrl, test } from './fixtures';
import { ean13ForAttempt, leadingZeroEan13 } from './helpers/ean13';
import { expectProblemDetails, waitForRequest } from './helpers/http';
import { archive, createFoodArticle, createNonFoodArticle, sell } from './helpers/state';

test('consults the current Dashboard with aligned KPIs, alerts and keyboard links', async ({ page }) => {
  const dashboard = page.locator('#dashboard-panel');
  const dashboardResponse = waitForRequest(page, 'GET', '/api/dashboard');

  await page.goto('/dashboard');
  const firstResponse = await dashboardResponse;
  expect(firstResponse.status()).toBe(200);
  const firstView = await firstResponse.json();
  expect(firstView.stockByArticle).toHaveLength(6);
  expect(firstView.stockByArticle.map((row: { ean13: string }) => row.ean13)).toEqual([
    leadingZeroEan13,
    '1234567890128',
    '2345678901234',
    '3456789012340',
    '4567890123456',
    '5678901234562',
  ]);
  expect(firstView.alerts.outOfStock.map((row: { ean13: string }) => row.ean13)).toEqual(['5678901234562']);
  expect(firstView.alerts.notSellable.map((row: { ean13: string }) => row.ean13)).toEqual([
    '1234567890128',
    '2345678901234',
    '3456789012340',
  ]);
  await expect(dashboard.locator('#dashboard-state')).toContainText('Articles suivis');
  await expect(dashboard.locator('#dashboard-kpi-physical')).toContainText('27 unités');
  await expect(dashboard.locator('#dashboard-kpi-sellable')).toContainText('13 unités');
  await expect(dashboard.locator('#dashboard-kpi-non-sellable')).toContainText('14 unités');

  await expect(dashboard.locator('#dashboard-table').getByRole('row', { name: /Alimentaire aux deux modes/ }))
    .toContainText(leadingZeroEan13);
  await expect(dashboard.locator('#dashboard-table').getByRole('row', { name: /Alimentaire aux deux modes/ }))
    .toContainText('5 unités');
  await expect(dashboard.locator('#dashboard-table').getByRole('row', { name: /Article archivé/ }))
    .toContainText('Archivé');
  await expect(dashboard.locator('#dashboard-table').getByRole('row', { name: /Article archivé/ }))
    .toContainText('4 unités');
  await expect(dashboard.locator('#dashboard-table').getByRole('row', { name: /Article actif sans position/ }))
    .toContainText('0 unités');

  await expect(dashboard.locator('#dashboard-alert-out-of-stock')).toContainText('Article actif sans position');
  await expect(dashboard.locator('#dashboard-alert-not-sellable')).toContainText('Alimentaire à DLC dépassée');
  await expect(dashboard.locator('#dashboard-alert-not-sellable')).toContainText('Article archivé');
  await expect(dashboard.locator('#dashboard-alert-not-sellable')).toContainText('Non alimentaire au Packaging Invendable');

  const alertLink = dashboard.locator('#dashboard-alert-out-of-stock').getByRole('link');
  await alertLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#dashboard-row-5678901234562$/);
  await expect(dashboard.locator('#dashboard-row-5678901234562')).toBeVisible();

  const reloadResponse = waitForRequest(page, 'GET', '/api/dashboard');
  await page.reload();
  const secondView = await (await reloadResponse).json();
  expect(secondView).toEqual(firstView);
  await expect(page.locator('#dashboard-panel #dashboard-kpi-physical')).toContainText('27 unités');
});

test('filters the Dashboard by explicit period and Article dimensions', async ({ page }) => {
  const dashboard = page.locator('#dashboard-panel');
  const dashboardResponse = waitForRequest(page, 'GET', '/api/dashboard');

  await page.goto('/dashboard');
  await expect(page.locator('#dashboard-from')).toHaveValue('2030-01-01');
  await expect(page.locator('#dashboard-to')).toHaveValue('2030-01-31');
  const initialResponse = await dashboardResponse;
  expect(initialResponse.url()).toContain('from=2030-01-01');
  expect(initialResponse.url()).toContain('to=2030-01-31');

  const foodResponse = waitForRequest(page, 'GET', '/api/dashboard', (url) => (
    url.searchParams.get('type') === 'food'
      && url.searchParams.get('mode') === null
  ));
  await page.locator('#dashboard-type').selectOption('food');
  await page.getByRole('button', { name: 'Lire le Dashboard' }).click();
  expect((await foodResponse).status()).toBe(200);
  await expect(dashboard.locator('#dashboard-table').getByRole('row', { name: /Alimentaire à DLC dépassée/ }))
    .toBeVisible();
  await expect(dashboard.locator('#dashboard-table').getByRole('row', { name: /Article archivé/ }))
    .toHaveCount(0);
  await expect(dashboard.locator('#dashboard-kpi-physical')).toContainText('12 unités');

  const filteredResponse = waitForRequest(page, 'GET', '/api/dashboard', (url) => (
    url.searchParams.get('type') === 'food'
      && url.searchParams.get('mode') === 'onsite'
  ));
  await page.locator('#dashboard-type').selectOption('food');
  await page.locator('#dashboard-mode').selectOption('onsite');
  await page.getByRole('button', { name: 'Lire le Dashboard' }).click();
  const response = await filteredResponse;
  expect(response.status()).toBe(200);
  expect(new URL(response.url()).searchParams.get('from')).toBe('2030-01-01');
  expect(new URL(response.url()).searchParams.get('to')).toBe('2030-01-31');
  await expect(dashboard.locator('#dashboard-table').getByRole('row', { name: /Alimentaire aux deux modes/ }))
    .toBeVisible();
  await expect(dashboard.locator('#dashboard-table').getByRole('row', { name: /Alimentaire à DLC dépassée/ }))
    .toHaveCount(0);
  await expect(dashboard.locator('#dashboard-kpi-physical')).toContainText('5 unités');

  const allTypeResponse = waitForRequest(page, 'GET', '/api/dashboard', (url) => (
    url.searchParams.get('type') === null
      && url.searchParams.get('mode') === 'onsite'
  ));
  await page.locator('#dashboard-type').selectOption('all');
  await page.getByRole('button', { name: 'Lire le Dashboard' }).click();
  expect((await allTypeResponse).status()).toBe(200);
  await expect(dashboard.locator('#dashboard-table').getByRole('row', { name: /Alimentaire aux deux modes/ }))
    .toBeVisible();
  await expect(dashboard.locator('#dashboard-table').getByRole('row', { name: /Article actif sans position/ }))
    .toBeVisible();
  await expect(dashboard.locator('#dashboard-kpi-physical')).toContainText('5 unités');

  const packagingResponse = waitForRequest(page, 'GET', '/api/dashboard', (url) => (
    url.searchParams.get('type') === 'nonFood'
      && url.searchParams.get('packaging') === 'refurbished'
  ));
  await page.locator('#dashboard-type').selectOption('nonFood');
  await page.locator('#dashboard-mode').selectOption('all');
  await page.locator('#dashboard-packaging').selectOption('refurbished');
  await page.getByRole('button', { name: 'Lire le Dashboard' }).click();
  const packaging = await packagingResponse;
  expect(packaging.status()).toBe(200);
  const packagingBody = await packaging.json();
  expect(packagingBody.stockByArticle.map((row: { ean13: string }) => row.ean13))
    .toEqual(['2345678901234']);
  expect(packagingBody.kpis).toEqual({ physicalStock: 4, sellableStock: 0, nonSellableStock: 4 });
  await expect(dashboard.locator('#dashboard-table').getByRole('row', { name: /Article archivé/ }))
    .toBeVisible();
  await expect(dashboard.locator('#dashboard-table').getByRole('row', { name: /Article actif vendable/ }))
    .toHaveCount(0);

  const takeawayResponse = waitForRequest(page, 'GET', '/api/dashboard', (url) => (
    url.searchParams.get('type') === 'food'
      && url.searchParams.get('mode') === 'takeaway'
  ));
  await page.locator('#dashboard-type').selectOption('food');
  await page.locator('#dashboard-packaging').selectOption('all');
  await page.locator('#dashboard-mode').selectOption('takeaway');
  await page.getByRole('button', { name: 'Lire le Dashboard' }).click();
  const takeaway = await takeawayResponse;
  expect(takeaway.status()).toBe(200);
  const takeawayBody = await takeaway.json();
  expect(takeawayBody.stockByArticle.map((row: { ean13: string }) => row.ean13))
    .toEqual([leadingZeroEan13, '1234567890128']);
  expect(takeawayBody.kpis).toEqual({ physicalStock: 12, sellableStock: 5, nonSellableStock: 7 });

  const incompatibleResponse = waitForRequest(page, 'GET', '/api/dashboard', (url) => (
    url.searchParams.get('type') === 'food'
      && url.searchParams.get('packaging') === 'new'
  ));
  await page.locator('#dashboard-packaging').selectOption('new');
  await page.getByRole('button', { name: 'Lire le Dashboard' }).click();
  const incompatible = await incompatibleResponse;
  expect(incompatible.status()).toBe(200);
  const incompatibleBody = await incompatible.json();
  expect(incompatibleBody.stockByArticle).toEqual([]);
  expect(incompatibleBody.kpis).toEqual({ physicalStock: 0, sellableStock: 0, nonSellableStock: 0 });
  await expect(dashboard.locator('#dashboard-state')).toContainText('Aucun Article');
});

test.describe('Dashboard daily flows', () => {
  test.use({ e2eSeed: 'flows', timezoneId: 'America/Los_Angeles' });

  test('keeps accepted daily flows in the API without rendering them on the Dashboard', async ({ page }) => {
    const dashboardResponse = waitForRequest(page, 'GET', '/api/dashboard');

    await page.goto('/dashboard');
    const firstResponse = await dashboardResponse;
    expect(firstResponse.status()).toBe(200);
    const firstView = await firstResponse.json();
    expect(firstView.flowsByDay).toHaveLength(31);
    expect(firstView.flowsByDay.slice(9, 13)).toEqual([
      { date: '2030-01-10', supplies: 0, sales: 2 },
      { date: '2030-01-11', supplies: 19, sales: 0 },
      { date: '2030-01-12', supplies: 2, sales: 5 },
      { date: '2030-01-13', supplies: 0, sales: 0 },
    ]);
    await expect(page.locator('#dashboard-from')).toHaveValue('2030-01-01');
    await expect(page.locator('#dashboard-to')).toHaveValue('2030-01-31');

    await expect(page.locator('#dashboard-flows-table')).toHaveCount(0);
    await expect(page.locator('#dashboard-panel')).not.toContainText('Flux quotidiens');

    const filteredResponse = waitForRequest(page, 'GET', '/api/dashboard', (url) => (
    url.searchParams.get('type') === 'food'
        && url.searchParams.get('mode') === 'onsite'
  ));
    await page.locator('#dashboard-type').selectOption('food');
    await page.locator('#dashboard-mode').selectOption('onsite');
    await page.getByRole('button', { name: 'Lire le Dashboard' }).click();
    const filteredView = await (await filteredResponse).json();
    expect(filteredView.flowsByDay.slice(9, 13)).toEqual([
      { date: '2030-01-10', supplies: 0, sales: 0 },
      { date: '2030-01-11', supplies: 5, sales: 0 },
      { date: '2030-01-12', supplies: 2, sales: 4 },
      { date: '2030-01-13', supplies: 0, sales: 0 },
    ]);

    const takeawayResponse = waitForRequest(page, 'GET', '/api/dashboard', (url) => (
    url.searchParams.get('type') === 'food'
        && url.searchParams.get('mode') === 'takeaway'
  ));
    await page.locator('#dashboard-mode').selectOption('takeaway');
    await page.getByRole('button', { name: 'Lire le Dashboard' }).click();
    const takeawayView = await (await takeawayResponse).json();
    expect(takeawayView.flowsByDay.slice(9, 13)).toEqual([
      { date: '2030-01-10', supplies: 0, sales: 2 },
      { date: '2030-01-11', supplies: 8, sales: 0 },
      { date: '2030-01-12', supplies: 2, sales: 1 },
      { date: '2030-01-13', supplies: 0, sales: 0 },
    ]);

    const assertNonFoodFlows = async (
      packaging: 'all' | 'new' | 'refurbished' | 'unsellable',
      expected: Array<{ date: string; supplies: number; sales: number }>,
    ) => {
      const responsePromise = waitForRequest(page, 'GET', '/api/dashboard', (url) => (
    url.searchParams.get('type') === 'nonFood'
          && url.searchParams.get('mode') === null
          && url.searchParams.get('packaging') === (packaging === 'all' ? null : packaging)
  ));
      await page.locator('#dashboard-mode').selectOption('all');
      await page.locator('#dashboard-type').selectOption('nonFood');
      await page.locator('#dashboard-packaging').selectOption(packaging);
      await page.getByRole('button', { name: 'Lire le Dashboard' }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      const view = await response.json();
      expect(view.flowsByDay.slice(9, 13)).toEqual(expected);
    };

    await assertNonFoodFlows('all', [
      { date: '2030-01-10', supplies: 0, sales: 0 },
      { date: '2030-01-11', supplies: 11, sales: 0 },
      { date: '2030-01-12', supplies: 0, sales: 0 },
      { date: '2030-01-13', supplies: 0, sales: 0 },
    ]);
    await assertNonFoodFlows('new', [
      { date: '2030-01-10', supplies: 0, sales: 0 },
      { date: '2030-01-11', supplies: 0, sales: 0 },
      { date: '2030-01-12', supplies: 0, sales: 0 },
      { date: '2030-01-13', supplies: 0, sales: 0 },
    ]);
    await assertNonFoodFlows('refurbished', [
      { date: '2030-01-10', supplies: 0, sales: 0 },
      { date: '2030-01-11', supplies: 7, sales: 0 },
      { date: '2030-01-12', supplies: 0, sales: 0 },
      { date: '2030-01-13', supplies: 0, sales: 0 },
    ]);
    await assertNonFoodFlows('unsellable', [
      { date: '2030-01-10', supplies: 0, sales: 0 },
      { date: '2030-01-11', supplies: 4, sales: 0 },
      { date: '2030-01-12', supplies: 0, sales: 0 },
      { date: '2030-01-13', supplies: 0, sales: 0 },
    ]);

    const readIncompatibleFlows = async (filters: string) => page.evaluate(async (path) => {
      const response = await fetch(path);
      return { status: response.status, body: await response.json() };
    }, `/api/dashboard?from=2030-01-01&to=2030-01-31&${filters}`);

    for (const filters of ['type=food&packaging=new', 'type=nonFood&mode=takeaway']) {
      const incompatible = await readIncompatibleFlows(filters);
      expect(incompatible.status).toBe(200);
      expect(incompatible.body.flowsByDay.slice(9, 13)).toEqual([
        { date: '2030-01-10', supplies: 0, sales: 0 },
        { date: '2030-01-11', supplies: 0, sales: 0 },
        { date: '2030-01-12', supplies: 0, sales: 0 },
        { date: '2030-01-13', supplies: 0, sales: 0 },
      ]);
    }
  });
});

test.describe('Dashboard daily flow calendar boundary', () => {
  test.use({ e2eSeed: 'flows-boundary', timezoneId: 'America/Los_Angeles' });

  test('uses the configured warehouse timezone around UTC midnight', async ({ page }) => {
    const dashboardResponse = waitForRequest(page, 'GET', '/api/dashboard');

    await page.goto('/dashboard');
    const response = await dashboardResponse;
    expect(response.status()).toBe(200);
    const view = await response.json();
    expect(view.flowsByDay.slice(9, 13)).toEqual([
      { date: '2030-01-10', supplies: 1, sales: 2 },
      { date: '2030-01-11', supplies: 20, sales: 0 },
      { date: '2030-01-12', supplies: 2, sales: 5 },
      { date: '2030-01-13', supplies: 0, sales: 0 },
    ]);
  });
});

test.describe('Dashboard financial indicators', () => {
  test.use({ e2eSeed: 'financial', timezoneId: 'America/Los_Angeles' });

  test('keeps historical mode facts when current food modes change', async ({ page }) => {
    const dashboard = page.locator('#dashboard-panel');
    const patchModes = async (ean13: string, modes: string[]) => {
      const response = await page.request.patch(
        `${apiUrl}/api/articles/${ean13}`,
        { data: { consumptionModes: modes } });
      expect(response.status()).toBe(200);
    };

    await page.goto('/dashboard');
    await expect(page.locator('#dashboard-from')).toHaveValue('2030-01-01');
    await patchModes('1234567890128', ['onsite']);
    await patchModes('1234567890128', ['takeaway']);
    await patchModes(leadingZeroEan13, ['takeaway']);
    await patchModes('5678901234562', ['takeaway']);

    await page.locator('#dashboard-from').fill('2030-01-10');
    await page.locator('#dashboard-to').fill('2030-01-10');
    await page.locator('#dashboard-type').selectOption('food');
    await page.locator('#dashboard-mode').selectOption('onsite');
    const aloneResponsePromise = waitForRequest(page, 'GET', '/api/dashboard', (url) => (
    url.searchParams.get('from') === '2030-01-10'
        && url.searchParams.get('to') === '2030-01-10'
        && url.searchParams.get('type') === 'food'
        && url.searchParams.get('mode') === 'onsite'
  ));
    await page.getByRole('button', { name: 'Lire le Dashboard' }).click();
    const aloneResponse = await aloneResponsePromise;
    expect(aloneResponse.status()).toBe(200);
    const aloneView = await aloneResponse.json();
    expect(aloneView.stockByArticle).toEqual([]);
    expect(aloneView.financial).toMatchObject({
      revenueHtCents: 1000,
      revenueTtcCents: 1100,
      vatCollectedCents: 100,
    });
    await expect(dashboard.locator('#dashboard-state'))
      .toContainText('Indicateurs financiers disponibles');
    await expect(dashboard.locator('#dashboard-financial')).toBeVisible();
    await expect(dashboard.locator('#dashboard-financial-revenue-ht')).toContainText('10,00');

    await patchModes(leadingZeroEan13, ['onsite']);
    const alongsideResponsePromise = waitForRequest(page, 'GET', '/api/dashboard', (url) => (
    url.searchParams.get('from') === '2030-01-10'
        && url.searchParams.get('to') === '2030-01-10'
        && url.searchParams.get('type') === 'food'
        && url.searchParams.get('mode') === 'onsite'
  ));
    await page.getByRole('button', { name: 'Lire le Dashboard' }).click();
    const alongsideResponse = await alongsideResponsePromise;
    expect(alongsideResponse.status()).toBe(200);
    const alongsideView = await alongsideResponse.json();
    expect(alongsideView.stockByArticle.map((row: { ean13: string }) => row.ean13))
      .toEqual([leadingZeroEan13]);
    expect(alongsideView.financial).toMatchObject({
      revenueHtCents: 1000,
      revenueTtcCents: 1100,
      vatCollectedCents: 100,
    });
    await expect(dashboard.locator('#dashboard-financial')).toBeVisible();
  });

  test('renders historical amounts by VAT rate and applies correction dates', async ({ page }) => {
    const dashboard = page.locator('#dashboard-panel');
    const initialResponsePromise = waitForRequest(page, 'GET', '/api/dashboard');

    await page.goto('/dashboard');
    const initialResponse = await initialResponsePromise;
    expect(initialResponse.status()).toBe(200);
    const initialView = await initialResponse.json();
    expect(initialView.financial.revenueHtCents).toBe(2000);
    expect(initialView.financial.revenueTtcCents).toBe(2255);
    expect(initialView.financial.vatCollectedCents).toBe(255);
    expect(initialView.financial.byTaxRate.map((line: {
      taxRate: { code: string };
      amountHtCents: number;
      vatCents: number;
      amountTtcCents: number;
    }) => [line.taxRate.code, line.amountHtCents, line.vatCents, line.amountTtcCents])).toEqual([
      ['takeaway', 1000, 55, 1055],
      ['onsite', 0, 0, 0],
      ['nonFood', 1000, 200, 1200],
    ]);

    await expect(dashboard.getByRole('heading', { name: 'Indicateurs financiers' })).toBeVisible();
    await expect(dashboard.locator('#dashboard-financial-revenue-ht')).toContainText('20,00');
    await expect(dashboard.locator('#dashboard-financial-revenue-ttc')).toContainText('22,55');
    await expect(dashboard.locator('#dashboard-financial-vat')).toContainText('2,55');
    const financialTable = dashboard.locator('#dashboard-financial-table');
    await expect(financialTable.getByRole('columnheader', { name: 'Taux de TVA' })).toBeVisible();
    await expect(financialTable.locator('tbody tr')).toHaveCount(3);
    await expect(financialTable.getByRole('row', { name: /5,5 %/ })).toContainText('10,55');
    await expect(financialTable.getByRole('row', { name: /10 %/ })).toContainText('0,00');
    await expect(financialTable.getByRole('row', { name: /20 %/ })).toContainText('12,00');

    await page.locator('#dashboard-from').fill('2030-01-20');
    await page.locator('#dashboard-to').fill('2030-01-20');
    const correctionResponsePromise = waitForRequest(page, 'GET', '/api/dashboard', (url) => (
    url.searchParams.get('from') === '2030-01-20'
        && url.searchParams.get('to') === '2030-01-20'
  ));
    await page.getByRole('button', { name: 'Lire le Dashboard' }).click();
    const correctionResponse = await correctionResponsePromise;
    expect(correctionResponse.status()).toBe(200);
    const correctionView = await correctionResponse.json();
    expect(correctionView.financial).toMatchObject({
      revenueHtCents: -1000,
      revenueTtcCents: -1100,
      vatCollectedCents: -100,
    });
    expect(correctionView.financial.byTaxRate.map((line: {
      taxRate: { code: string };
      amountHtCents: number;
      vatCents: number;
      amountTtcCents: number;
    }) => [line.taxRate.code, line.amountHtCents, line.vatCents, line.amountTtcCents])).toEqual([
      ['takeaway', 0, 0, 0],
      ['onsite', -1000, -100, -1100],
      ['nonFood', 0, 0, 0],
    ]);
    await expect(dashboard.locator('#dashboard-financial-revenue-ht')).toContainText('-10,00');
    await expect(financialTable.getByRole('row', { name: /10 %/ })).toContainText('-10,00');
    await expect(financialTable.getByRole('row', { name: /10 %/ })).toContainText('-1,00');
  });
});

test('keeps Dashboard controls and focus after a period error, then retries the same selection', async ({ page }) => {
  const dashboard = page.locator('#dashboard-panel');

  await page.goto('/dashboard');
  await expect(page.locator('#dashboard-from')).toHaveValue('2030-01-01');
  await expect(page.locator('#dashboard-to')).toHaveValue('2030-01-31');
  await expect(page.locator('label[for="dashboard-from"]')).toBeVisible();
  await expect(page.locator('label[for="dashboard-to"]')).toBeVisible();
  await expect(page.locator('label[for="dashboard-type"]')).toBeVisible();
  await expect(page.locator('label[for="dashboard-mode"]')).toBeVisible();
  await expect(page.locator('label[for="dashboard-packaging"]')).toBeVisible();
  await expect(dashboard.locator('#dashboard-state')).toHaveAttribute('role', 'status');

  const from = page.locator('#dashboard-from');
  const to = page.locator('#dashboard-to');
  await from.fill('2030-01-20');
  await to.fill('2030-01-15');
  await page.locator('#dashboard-type').selectOption('food');
  await page.locator('#dashboard-mode').selectOption('onsite');

  const invalidResponsePromise = waitForRequest(page, 'GET', '/api/dashboard', (url) => (
    url.searchParams.get('from') === '2030-01-20'
      && url.searchParams.get('to') === '2030-01-15'
  ));
  await page.getByRole('button', { name: 'Lire le Dashboard' }).click();
  const invalidResponse = await invalidResponsePromise;
  await expectProblemDetails(invalidResponse, { status: 400, code: 'dashboard.reversed_period' });
  await expect(dashboard.locator('#dashboard-state [role="alert"]')).toContainText('invalide');
  await expect(from).toHaveValue('2030-01-20');
  await expect(to).toHaveValue('2030-01-15');
  await expect(page.locator('#dashboard-type')).toHaveValue('food');
  await expect(page.locator('#dashboard-mode')).toHaveValue('onsite');
  await expect(page.locator('#dashboard-packaging')).toBeEnabled();
  await expect(from).toHaveAttribute('aria-invalid', 'true');
  await expect(from).toHaveAttribute('aria-describedby', 'dashboard-from-error');
  await expect(from).toBeFocused();

  await to.fill('2030-01-20');
  const retryResponsePromise = waitForRequest(page, 'GET', '/api/dashboard', (url) => (
    url.searchParams.get('from') === '2030-01-20'
      && url.searchParams.get('to') === '2030-01-20'
  ));
  await page.getByRole('button', { name: 'Lire le Dashboard' }).click();
  const retryResponse = await retryResponsePromise;
  expect(retryResponse.status()).toBe(200);
  await expect(dashboard.locator('#dashboard-state')).toContainText('2 Articles suivis.');
  await expect(page.locator('#dashboard-from')).toHaveValue('2030-01-20');
  await expect(page.locator('#dashboard-to')).toHaveValue('2030-01-20');
  await expect(page.locator('#dashboard-type')).toHaveValue('food');
  await expect(page.locator('#dashboard-mode')).toHaveValue('onsite');
  await expect(dashboard.locator('#dashboard-table').getByRole('row', { name: /Alimentaire aux deux modes/ }))
    .toBeVisible();
});

test.describe('Dashboard states', () => {
  test.use({ e2eSeed: 'empty' });

  test('announces Dashboard loading, empty and error states', async ({ page }) => {
    const dashboardState = page.locator('#dashboard-state');
    const dashboardRoute = /\/api\/dashboard(?:\?.*)?$/;
    let releaseLoading!: () => void;
    const loading = new Promise<void>((resolve) => {
      releaseLoading = resolve;
    });
    const delayedDashboardRoute = async (route: Route) => {
      await loading;
      await route.continue();
    };

    await page.route(dashboardRoute, delayedDashboardRoute);
    const navigation = page.goto('/dashboard');
    await expect(dashboardState).toContainText('Chargement du Dashboard');
    releaseLoading();
    await navigation;
    await expect(dashboardState).toContainText('Aucun Article');
    await expect(page.locator('#dashboard-financial')).toHaveCount(0);
    await page.unroute(dashboardRoute, delayedDashboardRoute);

    const stateRoute = async (route: Route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'Le Dashboard est indisponible.', code: 'internal_error' }),
      });
    };
    await page.route(dashboardRoute, stateRoute);

    await page.reload();
    await expect(dashboardState.locator('[role="alert"]')).toContainText('indisponible');
    await expect(page.locator('#dashboard-table')).toHaveCount(0);
    await page.unroute(dashboardRoute, stateRoute);

    await createFoodArticle(page, {
      ean13: leadingZeroEan13,
      name: 'Article Dashboard',
      modes: ['takeaway'],
      dlc: '2030-01-15',
      priceHtCents: 1000,
    });

    await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect(dashboardState).toContainText('Article suivi');
    await expect(page.locator('#dashboard-table')).toContainText('Article Dashboard');
  });
});

test.describe('Dashboard Stock semantics', () => {
  test.use({ e2eSeed: 'financial', timezoneId: 'America/Los_Angeles' });

  test('keeps current Stock KPIs while past-period flows and financial indicators change', async ({ page }) => {
    await sell(page, leadingZeroEan13, 1, 'takeaway');

    await page.goto('/dashboard');
    await page.locator('#dashboard-from').fill('2030-01-15');
    await page.locator('#dashboard-to').fill('2030-01-15');
    const currentResponsePromise = waitForRequest(page, 'GET', '/api/dashboard', (url) => (
      url.searchParams.get('from') === '2030-01-15'
        && url.searchParams.get('to') === '2030-01-15'
    ));
    await page.getByRole('button', { name: 'Lire le Dashboard' }).click();
    const currentView = await (await currentResponsePromise).json();
    await expect(page.locator('#dashboard-financial-revenue-ht')).toContainText('1,00');

    await page.locator('#dashboard-from').fill('2030-01-10');
    await page.locator('#dashboard-to').fill('2030-01-10');
    const pastResponsePromise = waitForRequest(page, 'GET', '/api/dashboard', (url) => (
      url.searchParams.get('from') === '2030-01-10'
        && url.searchParams.get('to') === '2030-01-10'
    ));
    await page.getByRole('button', { name: 'Lire le Dashboard' }).click();
    const pastView = await (await pastResponsePromise).json();

    expect(pastView.kpis).toEqual(currentView.kpis);
    expect(currentView.flowsByDay).toEqual([{ date: '2030-01-15', supplies: 0, sales: 1 }]);
    expect(pastView.flowsByDay).toEqual([{ date: '2030-01-10', supplies: 0, sales: 3 }]);
    expect(currentView.financial).toMatchObject({
      revenueHtCents: 100,
      revenueTtcCents: 106,
      vatCollectedCents: 6,
    });
    expect(pastView.financial).toMatchObject({
      revenueHtCents: 3000,
      revenueTtcCents: 3355,
      vatCollectedCents: 355,
    });
    await expect(page.locator('#dashboard-financial-revenue-ht')).toContainText('30,00');
    await expect(page.locator('#dashboard-kpi-physical')).toContainText(`${currentView.kpis.physicalStock} unités`);
    await expect(page.locator('#dashboard-kpi-sellable')).toContainText(`${currentView.kpis.sellableStock} unités`);
    await expect(page.locator('#dashboard-kpi-non-sellable')).toContainText(`${currentView.kpis.nonSellableStock} unités`);
  });

  test('renders an impossible filter intersection as empty', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('#dashboard-type').selectOption('nonFood');
    await page.locator('#dashboard-mode').selectOption('onsite');
    const emptyResponsePromise = waitForRequest(page, 'GET', '/api/dashboard', (url) => (
      url.searchParams.get('type') === 'nonFood'
        && url.searchParams.get('mode') === 'onsite'
    ));
    await page.getByRole('button', { name: 'Lire le Dashboard' }).click();
    const emptyView = await (await emptyResponsePromise).json();

    expect(emptyView.stockByArticle).toEqual([]);
    expect(emptyView.kpis).toEqual({ physicalStock: 0, sellableStock: 0, nonSellableStock: 0 });
    await expect(page.locator('#dashboard-state')).toContainText('Aucun Article');
    await expect(page.locator('#dashboard-table')).toHaveCount(0);
  });

  test('renders every Stock column for Articles in three different states', async ({ page }) => {
    await page.goto('/dashboard');
    const table = page.locator('#dashboard-table');
    const expectedRows = [
      [
        leadingZeroEan13,
        'Alimentaire aux deux modes',
        'Alimentaire',
        'Actif',
        '5 unités',
        '5 unités',
        '0 unités',
        'Disponible',
        '—',
      ],
      [
        '1234567890128',
        'Alimentaire à DLC dépassée',
        'Alimentaire',
        'Actif',
        '7 unités',
        '0 unités',
        '7 unités',
        'Non vendable',
        'DLC dépassée',
      ],
      [
        '2345678901234',
        'Article archivé',
        'Non alimentaire',
        'Archivé',
        '4 unités',
        '0 unités',
        '4 unités',
        'Non vendable',
        'Article archivé',
      ],
    ];

    for (const [ean13, ...cells] of expectedRows) {
      await expect(table.getByRole('row', { name: new RegExp(ean13) }).locator('th, td'))
        .toHaveText([ean13, ...cells]);
    }
  });

  test('keeps active ruptures separate from Articles non vendables', async ({ page }) => {
    const archivedOutOfStockEan13 = ean13ForAttempt('720000001', 0);
    await createNonFoodArticle(page, {
      ean13: archivedOutOfStockEan13,
      name: 'Article archivé sans Stock',
      packaging: 'new',
      priceHtCents: 100,
    });
    await archive(page, archivedOutOfStockEan13);
    const responsePromise = waitForRequest(page, 'GET', '/api/dashboard');

    await page.goto('/dashboard');
    const view = await (await responsePromise).json();

    expect(view.alerts.outOfStock).toMatchObject([{
      ean13: '5678901234562',
      lifecycleStatus: 'ACTIVE',
      physicalStock: 0,
      sellableStock: 0,
    }]);
    expect(view.alerts.outOfStock).not.toContainEqual(
      expect.objectContaining({ ean13: archivedOutOfStockEan13 }),
    );
    expect(view.alerts.notSellable).toMatchObject([
      { ean13: '1234567890128', physicalStock: 7, sellableStock: 0, reason: 'DLC_EXPIRED' },
      { ean13: '2345678901234', physicalStock: 4, sellableStock: 0, reason: 'ARCHIVED' },
      { ean13: '3456789012340', physicalStock: 3, sellableStock: 0, reason: 'UNSELLABLE_PACKAGING' },
    ]);
    await expect(page.locator('#dashboard-alert-out-of-stock')).not.toContainText(archivedOutOfStockEan13);
    await expect(page.locator('#dashboard-alert-out-of-stock')).not.toContainText('Article archivé');
    await expect(page.locator('#dashboard-alert-not-sellable'))
      .toContainText('Article archivé — 2345678901234 — Article archivé');
  });
});

test.describe('Dashboard flow continuity', () => {
  test.use({ e2eSeed: 'flows', timezoneId: 'America/Los_Angeles' });

  test('keeps an inactive day at zero between two active days', async ({ page }) => {
    const responsePromise = waitForRequest(page, 'GET', '/api/dashboard');

    await page.goto('/dashboard');
    const view = await (await responsePromise).json();
    expect(view.flowsByDay.slice(11, 14)).toEqual([
      { date: '2030-01-12', supplies: 2, sales: 5 },
      { date: '2030-01-13', supplies: 0, sales: 0 },
      { date: '2030-01-14', supplies: 1, sales: 0 },
    ]);
  });
});

test.describe('Dashboard correction date', () => {
  test.use({ e2eSeed: 'financial', timezoneId: 'America/Los_Angeles' });

  test('attributes a financial Counter-movement negatively on its correction date', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('#dashboard-from').fill('2030-01-10');
    await page.locator('#dashboard-to').fill('2030-01-10');
    const sourceResponsePromise = waitForRequest(page, 'GET', '/api/dashboard', (url) => (
      url.searchParams.get('from') === '2030-01-10'
        && url.searchParams.get('to') === '2030-01-10'
    ));
    await page.getByRole('button', { name: 'Lire le Dashboard' }).click();
    const sourceView = await (await sourceResponsePromise).json();
    expect(sourceView.financial.byTaxRate).toContainEqual(expect.objectContaining({
      taxRate: expect.objectContaining({ code: 'onsite' }),
      amountHtCents: 1000,
      vatCents: 100,
      amountTtcCents: 1100,
    }));

    await page.locator('#dashboard-from').fill('2030-01-20');
    await page.locator('#dashboard-to').fill('2030-01-20');
    const correctionResponsePromise = waitForRequest(page, 'GET', '/api/dashboard', (url) => (
      url.searchParams.get('from') === '2030-01-20'
        && url.searchParams.get('to') === '2030-01-20'
    ));
    await page.getByRole('button', { name: 'Lire le Dashboard' }).click();
    const correctionView = await (await correctionResponsePromise).json();
    expect(correctionView.financial.byTaxRate).toContainEqual(expect.objectContaining({
      taxRate: expect.objectContaining({ code: 'onsite' }),
      amountHtCents: -1000,
      vatCents: -100,
      amountTtcCents: -1100,
    }));
    await expect(page.locator('#dashboard-financial-table').getByRole('row', { name: /10 %/ }))
      .toContainText('-11,00');
  });
});
