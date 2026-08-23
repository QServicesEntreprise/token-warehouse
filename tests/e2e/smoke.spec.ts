import { expect } from '@playwright/test';
import { apiUrl, test } from './fixtures';
import type { Route } from '@playwright/test';
import { leadingZeroEan13 } from './helpers/ean13';
import { expectProblemDetails, waitForRequest } from './helpers/http';



test('consults the current Dashboard with aligned KPIs, alerts and keyboard links', async ({ page }) => {
  const dashboard = page.locator('#dashboard-panel');
  const dashboardResponse = waitForRequest(page, 'GET', '/api/dashboard');

  await page.goto('/');
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

  await page.goto('/');
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

  test('renders accepted flows as an accessible filtered daily table', async ({ page }) => {
    const dashboard = page.locator('#dashboard-panel');
    const dashboardResponse = waitForRequest(page, 'GET', '/api/dashboard');

    await page.goto('/');
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

    const flowTable = dashboard.locator('#dashboard-flows-table');
    await expect(flowTable).toBeVisible();
    await expect(flowTable.getByRole('columnheader', { name: 'Date' })).toBeVisible();
    await expect(flowTable.getByRole('columnheader', { name: 'Approvisionnements' })).toBeVisible();
    await expect(flowTable.getByRole('columnheader', { name: 'Ventes' })).toBeVisible();
    await expect(flowTable.locator('tbody tr')).toHaveCount(31);
    await expect(flowTable.getByRole('row', { name: /2030-01-10/ })).toContainText('0 unité');
    await expect(flowTable.getByRole('row', { name: /2030-01-11/ })).toContainText('19 unités');
    await expect(flowTable.getByRole('row', { name: /2030-01-13/ })).toContainText('0 unité');

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
    await expect(flowTable.getByRole('row', { name: /2030-01-10/ })).toContainText('0 unité');
    await expect(flowTable.getByRole('row', { name: /2030-01-11/ })).toContainText('5 unités');
    await expect(flowTable.getByRole('row', { name: /2030-01-12/ })).toContainText('4 unités');

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
      renderedSupplies: string,
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
      await expect(flowTable.getByRole('row', { name: /2030-01-11/ }))
        .toContainText(renderedSupplies);
    };

    await assertNonFoodFlows('all', [
      { date: '2030-01-10', supplies: 0, sales: 0 },
      { date: '2030-01-11', supplies: 11, sales: 0 },
      { date: '2030-01-12', supplies: 0, sales: 0 },
      { date: '2030-01-13', supplies: 0, sales: 0 },
    ], '11 unités');
    await assertNonFoodFlows('new', [
      { date: '2030-01-10', supplies: 0, sales: 0 },
      { date: '2030-01-11', supplies: 0, sales: 0 },
      { date: '2030-01-12', supplies: 0, sales: 0 },
      { date: '2030-01-13', supplies: 0, sales: 0 },
    ], '0 unité');
    await assertNonFoodFlows('refurbished', [
      { date: '2030-01-10', supplies: 0, sales: 0 },
      { date: '2030-01-11', supplies: 7, sales: 0 },
      { date: '2030-01-12', supplies: 0, sales: 0 },
      { date: '2030-01-13', supplies: 0, sales: 0 },
    ], '7 unités');
    await assertNonFoodFlows('unsellable', [
      { date: '2030-01-10', supplies: 0, sales: 0 },
      { date: '2030-01-11', supplies: 4, sales: 0 },
      { date: '2030-01-12', supplies: 0, sales: 0 },
      { date: '2030-01-13', supplies: 0, sales: 0 },
    ], '4 unités');

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

    await page.goto('/');
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

    await page.goto('/');
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

    await page.goto('/');
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

  await page.goto('/');
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
    const navigation = page.goto('/');
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

    await page.locator('#ean13').fill(leadingZeroEan13);
    await page.locator('#name').fill('Article Dashboard');
    await page.locator('#priceHtCents').fill('1000');
    await page.locator('#dlc').fill('2030-01-15');
    await page.locator('#consumptionModes').getByLabel('À emporter').check();
    await page.getByRole('button', { name: 'Créer l’Article' }).click();
    await expect(page.getByRole('heading', { name: 'Article Dashboard' })).toBeVisible();

    await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect(dashboardState).toContainText('Article suivi');
    await expect(page.locator('#dashboard-table')).toContainText('Article Dashboard');
  });
});

test('records a unit supply and shows the committed stocks after reload', async ({ page }) => {
  const ean13 = '4567890123456';
  const expiredEan13 = '1234567890128';
  const unsellableEan13 = '3456789012340';
  const supplyPanel = page.locator('#supply-panel');
  const stockRow = (articleEan13: string) => page.locator('#stock-table').getByRole('row', { name: new RegExp(articleEan13) });

  await page.goto('/');
  await expect(supplyPanel.getByRole('heading', { name: 'Enregistrer un Approvisionnement' })).toBeVisible();
  await expect(stockRow(ean13)).toContainText('8 unités');

  await supplyPanel.locator('#supplyEan13').fill(ean13);
  await supplyPanel.locator('#supplyQuantity').fill('5');
  const responsePromise = waitForRequest(page, 'POST', '/api/supplies');
  await supplyPanel.getByRole('button', { name: 'Enregistrer l’Approvisionnement' }).click();
  const response = await responsePromise;

  expect(response.status()).toBe(201);
  const supplyBody = await response.json() as {
    operation: {
      id: string;
      occurredAt: string;
    };
  };
  expect(supplyBody.operation.id).toMatch(/\S+/);
  expect(supplyBody.operation.occurredAt).toBe('2030-01-15T10:00:00+00:00');
  await expect(supplyPanel.locator('#supply-status')).toContainText(
    `Approvisionnement ${supplyBody.operation.id} enregistré le ${supplyBody.operation.occurredAt}.`,
  );
  await expect(supplyPanel.locator('#supply-status')).toBeFocused();
  await expect(stockRow(ean13)).toContainText('13 unités');
  await expect(stockRow(ean13)).toContainText('Disponible');

  await page.reload();
  await expect(stockRow(ean13)).toContainText('13 unités');
  await expect(stockRow(ean13)).toContainText('Disponible');

  await supplyPanel.locator('#supplyEan13').fill(expiredEan13);
  await supplyPanel.locator('#supplyQuantity').fill('2');
  const expiredResponsePromise = waitForRequest(page, 'POST', '/api/supplies');
  await supplyPanel.getByRole('button', { name: 'Enregistrer l’Approvisionnement' }).click();
  const expiredResponse = await expiredResponsePromise;
  expect(expiredResponse.status()).toBe(201);
  expect(await expiredResponse.json()).toMatchObject({
    operation: { type: 'supply', ean13: expiredEan13, quantity: 2 },
    position: {
      ean13: expiredEan13,
      physicalQuantity: 9,
      sellableQuantity: 0,
      availability: 'NOT_SELLABLE',
      reason: 'DLC_EXPIRED',
    },
  });
  await expect(stockRow(expiredEan13)).toContainText('9 unités');
  await expect(stockRow(expiredEan13)).toContainText('0 unités');
  await expect(stockRow(expiredEan13)).toContainText('DLC dépassée');

  await supplyPanel.locator('#supplyEan13').fill(unsellableEan13);
  await supplyPanel.locator('#supplyQuantity').fill('2');
  const unsellableResponsePromise = waitForRequest(page, 'POST', '/api/supplies');
  await supplyPanel.getByRole('button', { name: 'Enregistrer l’Approvisionnement' }).click();
  const unsellableResponse = await unsellableResponsePromise;
  expect(unsellableResponse.status()).toBe(201);
  expect(await unsellableResponse.json()).toMatchObject({
    operation: { type: 'supply', ean13: unsellableEan13, quantity: 2 },
    position: {
      ean13: unsellableEan13,
      physicalQuantity: 5,
      sellableQuantity: 0,
      availability: 'NOT_SELLABLE',
      reason: 'UNSELLABLE_PACKAGING',
    },
  });
  await expect(stockRow(unsellableEan13)).toContainText('5 unités');
  await expect(stockRow(unsellableEan13)).toContainText('0 unités');
  await expect(stockRow(unsellableEan13)).toContainText('Packaging invendable');

  const reloadStockResponsePromise = waitForRequest(page, 'GET', '/api/stock');
  await page.reload();
  const reloadStockResponse = await reloadStockResponsePromise;
  expect(reloadStockResponse.status()).toBe(200);
  expect(await reloadStockResponse.json()).toEqual(expect.arrayContaining([
    expect.objectContaining({
      ean13: expiredEan13,
      physicalQuantity: 9,
      sellableQuantity: 0,
      reason: 'DLC_EXPIRED',
    }),
    expect.objectContaining({
      ean13: unsellableEan13,
      physicalQuantity: 5,
      sellableQuantity: 0,
      reason: 'UNSELLABLE_PACKAGING',
    }),
  ]));
  await expect(stockRow(expiredEan13)).toContainText('9 unités');
  await expect(stockRow(expiredEan13)).toContainText('DLC dépassée');
  await expect(stockRow(unsellableEan13)).toContainText('5 unités');
  await expect(stockRow(unsellableEan13)).toContainText('Packaging invendable');

  let releaseDelayedSupply!: () => void;
  const delayedSupply = new Promise<void>((resolve) => {
    releaseDelayedSupply = resolve;
  });
  const supplyRoute = /\/api\/supplies$/;
  const delayedSupplyRoute = async (route: Route) => {
    await delayedSupply;
    await route.continue();
  };
  await page.route(supplyRoute, delayedSupplyRoute);

  await supplyPanel.locator('#supplyEan13').fill(ean13);
  await supplyPanel.locator('#supplyQuantity').fill('1');
  const delayedRequestPromise = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return request.method() === 'POST' && url.pathname === '/api/supplies';
  });
  const delayedResponsePromise = waitForRequest(page, 'POST', '/api/supplies');
  await supplyPanel.locator('#supplyQuantity').press('Enter');
  await delayedRequestPromise;
  await expect(stockRow(ean13)).toContainText('13 unités');
  await expect(stockRow(ean13)).not.toContainText('14 unités');
  await expect(supplyPanel.locator('#supplyQuantity')).toHaveValue('1');
  await expect(supplyPanel.getByRole('button', { name: 'Réception…' })).toBeDisabled();
  releaseDelayedSupply();
  const delayedResponse = await delayedResponsePromise;
  expect(delayedResponse.status()).toBe(201);
  await expect(stockRow(ean13)).toContainText('14 unités');
  await expect(supplyPanel.locator('#supply-status')).toContainText('Approvisionnement');
  await expect(supplyPanel.locator('#supply-status')).toBeFocused();
  await page.unroute(supplyRoute, delayedSupplyRoute);

  await supplyPanel.locator('#supplyQuantity').fill('0');
  const invalidResponsePromise = waitForRequest(page, 'POST', '/api/supplies');
  await supplyPanel.locator('#supplyQuantity').press('Enter');
  const invalidResponse = await invalidResponsePromise;
  expect(invalidResponse.status()).toBe(400);
  expect(invalidResponse.headers()['content-type']).toContain('application/problem+json');
  await expect(supplyPanel.locator('#supply-status')).toContainText('invalide');
  await expect(supplyPanel.locator('#supply-quantity-error')).toContainText('strictement positif');
  await expect(supplyPanel.locator('#supplyEan13')).toHaveValue(ean13);
  await expect(supplyPanel.locator('#supplyQuantity')).toHaveValue('0');
  await expect(supplyPanel.locator('#supplyQuantity')).toBeFocused();
  await expect(stockRow(ean13)).toContainText('14 unités');

  await supplyPanel.locator('#supplyEan13').fill('4006381333931');
  await supplyPanel.locator('#supplyQuantity').fill('2');
  const unknownResponsePromise = waitForRequest(page, 'POST', '/api/supplies');
  await supplyPanel.getByRole('button', { name: 'Enregistrer l’Approvisionnement' }).click();
  const unknownResponse = await unknownResponsePromise;
  expect(unknownResponse.status()).toBe(404);
  expect(unknownResponse.headers()['content-type']).toContain('application/problem+json');
  await expect(supplyPanel.locator('#supply-status')).toContainText('introuvable');
  await expect(supplyPanel.locator('#supply-status')).toBeFocused();
  await expect(supplyPanel.locator('#supplyEan13')).toHaveValue('4006381333931');
  await expect(supplyPanel.locator('#supplyQuantity')).toHaveValue('2');

  await supplyPanel.locator('#supplyEan13').fill('2345678901234');
  const archivedResponsePromise = waitForRequest(page, 'POST', '/api/supplies');
  await supplyPanel.getByRole('button', { name: 'Enregistrer l’Approvisionnement' }).click();
  const archivedResponse = await archivedResponsePromise;
  expect(archivedResponse.status()).toBe(409);
  expect(archivedResponse.headers()['content-type']).toContain('application/problem+json');
  await expect(supplyPanel.locator('#supply-status')).toContainText('archivé');
  await expect(supplyPanel.locator('#supplyEan13')).toBeFocused();
  await expect(supplyPanel.locator('#supplyEan13')).toHaveValue('2345678901234');
  await expect(supplyPanel.locator('#supplyQuantity')).toHaveValue('2');

  const supplyFailureRoute = /\/api\/supplies$/;
  await page.route(supplyFailureRoute, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/problem+json',
      body: JSON.stringify({ title: 'Une erreur interne est survenue.', code: 'internal_error' }),
    });
  });
  await supplyPanel.locator('#supplyEan13').fill(ean13);
  await supplyPanel.locator('#supplyQuantity').fill('1');
  const failureResponsePromise = waitForRequest(page, 'POST', '/api/supplies');
  await supplyPanel.getByRole('button', { name: 'Enregistrer l’Approvisionnement' }).click();
  const failureResponse = await failureResponsePromise;
  expect(failureResponse.status()).toBe(500);
  expect(failureResponse.headers()['content-type']).toContain('application/problem+json');
  await expect(supplyPanel.locator('#supply-status')).toContainText('erreur interne');
  await expect(supplyPanel.locator('#supply-status')).toBeFocused();
  await expect(supplyPanel.locator('#supplyQuantity')).toHaveValue('1');
  await expect(stockRow(ean13)).toContainText('14 unités');
  await page.unroute(supplyFailureRoute);

  await page.screenshot({ path: 'artifacts/playwright/supply.png', fullPage: true });
});

test('records a multi-Article supply atomically and keeps all drafts after rejection', async ({ page }) => {
  const firstEan13 = '4567890123456';
  const secondEan13 = '5678901234562';
  const unknownEan13 = '4006381333931';
  const supplyPanel = page.locator('#supply-panel');
  const firstStockRow = page.locator('#stock-table').getByRole('row', { name: new RegExp(firstEan13) });

  await page.goto('/');
  await expect(firstStockRow).toContainText('8 unités');
  await supplyPanel.locator('#supplyEan13').fill(firstEan13);
  await supplyPanel.locator('#supplyQuantity').fill('3');
  await supplyPanel.getByRole('button', { name: 'Ajouter une ligne' }).click();
  await supplyPanel.locator('#supplyEan13-1').fill(secondEan13);
  await supplyPanel.locator('#supplyQuantity-1').fill('5');

  const successResponsePromise = waitForRequest(page, 'POST', '/api/supplies/bulk');
  await supplyPanel.getByRole('button', { name: 'Enregistrer l’Approvisionnement' }).click();
  const successResponse = await successResponsePromise;
  expect(successResponse.status()).toBe(201);
  expect(successResponse.headers()['content-type']).toContain('application/json');
  await expect(firstStockRow).toContainText('11 unités');
  await expect(page.locator('#stock-table').getByRole('row', { name: new RegExp(secondEan13) })).toContainText('5 unités');

  const successBody = await successResponse.json() as {
    operation: {
      id: string;
      lines: { ean13: string; quantity: number }[];
    };
    positions: { ean13: string; physicalQuantity: number; sellableQuantity: number }[];
  };
  expect(successBody.operation.lines).toEqual([
    { lineNumber: 1, ean13: firstEan13, quantity: 3 },
    { lineNumber: 2, ean13: secondEan13, quantity: 5 },
  ]);
  expect(successBody.positions).toEqual(expect.arrayContaining([
    expect.objectContaining({ ean13: firstEan13, physicalQuantity: 11, sellableQuantity: 11 }),
    expect.objectContaining({ ean13: secondEan13, physicalQuantity: 5, sellableQuantity: 5 }),
  ]));

  await page.reload();
  await expect(page.locator('#stock-table').getByRole('row', { name: new RegExp(firstEan13) })).toContainText('11 unités');
  await expect(page.locator('#stock-table').getByRole('row', { name: new RegExp(secondEan13) })).toContainText('5 unités');

  await supplyPanel.locator('#supplyEan13').fill(firstEan13);
  await supplyPanel.locator('#supplyQuantity').fill('3');
  await supplyPanel.getByRole('button', { name: 'Ajouter une ligne' }).click();
  await supplyPanel.locator('#supplyEan13-1').fill(unknownEan13);
  await supplyPanel.locator('#supplyQuantity-1').fill('5');
  const rejectedResponsePromise = waitForRequest(page, 'POST', '/api/supplies/bulk');
  await supplyPanel.locator('#supplyQuantity-1').press('Enter');
  const rejectedResponse = await rejectedResponsePromise;
  expect(rejectedResponse.status()).toBe(404);
  expect(rejectedResponse.headers()['content-type']).toContain('application/problem+json');
  await expect(firstStockRow).toContainText('11 unités');
  await expect(supplyPanel.locator('#supplyEan13')).toHaveValue(firstEan13);
  await expect(supplyPanel.locator('#supplyQuantity')).toHaveValue('3');
  await expect(supplyPanel.locator('#supplyEan13-1')).toHaveValue(unknownEan13);
  await expect(supplyPanel.locator('#supplyQuantity-1')).toHaveValue('5');
  await expect(supplyPanel.locator('#supply-status')).toContainText('introuvable');

  await supplyPanel.locator('#supplyQuantity').fill('0');
  const mixedResponsePromise = waitForRequest(page, 'POST', '/api/supplies/bulk');
  await supplyPanel.getByRole('button', { name: 'Enregistrer l’Approvisionnement' }).click();
  const mixedResponse = await mixedResponsePromise;
  expect(mixedResponse.status()).toBe(400);
  expect(mixedResponse.headers()['content-type']).toContain('application/problem+json');
  await expect(supplyPanel.locator('#supply-quantity-error')).toContainText('quantité');
  await expect(supplyPanel.locator('#supply-ean13-1-error')).toContainText('introuvable');
  await expect(supplyPanel.locator('#supply-status')).toContainText('invalide');
  await expect(supplyPanel.locator('#supplyEan13')).toHaveValue(firstEan13);
  await expect(supplyPanel.locator('#supplyQuantity')).toHaveValue('0');
  await expect(supplyPanel.locator('#supplyEan13-1')).toHaveValue(unknownEan13);
  await expect(supplyPanel.locator('#supplyQuantity-1')).toHaveValue('5');

  await supplyPanel.locator('#supplyQuantity').fill('3');
  await supplyPanel.locator('#supplyEan13-1').fill(firstEan13);
  const duplicateResponsePromise = waitForRequest(page, 'POST', '/api/supplies/bulk');
  await supplyPanel.getByRole('button', { name: 'Enregistrer l’Approvisionnement' }).click();
  const duplicateResponse = await duplicateResponsePromise;
  expect(duplicateResponse.status()).toBe(400);
  expect(duplicateResponse.headers()['content-type']).toContain('application/problem+json');
  await expect(supplyPanel.locator('#supply-ean13-error')).toContainText('seule');
  await expect(supplyPanel.locator('#supply-ean13-1-error')).toContainText('seule');
  await expect(supplyPanel.locator('#supply-status')).toContainText('invalide');
  await expect(firstStockRow).toContainText('11 unités');
  await page.screenshot({ path: 'artifacts/playwright/bulk-supply.png', fullPage: true });
});
