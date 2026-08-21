import { expect, test } from './e2e-fixture';
import type { Route } from '@playwright/test';

const ean13ForAttempt = (prefix: string, attempt: number): string => {
  const body = `${prefix}${String(attempt).padStart(3, '0')}`;
  const checksum = (10 - [...body].reduce(
    (sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  ) % 10) % 10;
  return `${body}${checksum}`;
};

test('searches and filters the catalogue, including an archived detail', async ({ page }, testInfo) => {
  const attempt = testInfo.repeatEachIndex * (testInfo.project.retries + 1) + testInfo.retry;
  const foodEan = ean13ForAttempt('012345678', attempt);
  const singleFoodEan = ean13ForAttempt('012345670', attempt);
  const nonFoodEan = ean13ForAttempt('400638133', attempt);
  const catalogPanel = page.locator('section[aria-labelledby="catalog-title"]');
  const articleRow = (ean13: string) => catalogPanel.getByRole('row', { name: new RegExp(ean13) });
  const articleDetailText = (text: string) => page.locator('.article-detail').getByText(text);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Créer et consulter un Article' })).toBeVisible();
  await page.locator('#catalog-search').fill(foodEan);
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.getByText('Aucun Article ne correspond à ces critères.')).toBeVisible();
  await page.locator('#catalog-search').fill('');

  await page.locator('#catalog-status').selectOption('archived');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(catalogPanel.getByRole('row', { name: /Biscuit historique/ })).toBeVisible();
  await expect(catalogPanel.getByRole('row', { name: /Lampe historique/ })).toBeVisible();
  await page.getByRole('button', { name: 'Consulter Biscuit historique' }).click();
  await expect(page.getByRole('heading', { name: 'Biscuit historique' })).toBeVisible();
  await expect(page.locator('section[aria-labelledby="lookup-title"]').getByText('Archivé')).toBeVisible();

  await page.locator('#catalog-status').selectOption('all');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(catalogPanel.getByRole('row', { name: /Biscuit historique/ })).toBeVisible();
  await expect(catalogPanel.getByRole('row', { name: /Lampe historique/ })).toBeVisible();

  await page.locator('#catalog-status').selectOption('active');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();

  await page.locator('#ean13').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#type')).toBeFocused();

  await page.locator('#ean13').fill(foodEan);
  await page.locator('#name').fill('Chocolat noir');
  await page.locator('#priceHtCents').fill('1000');
  await page.locator('#dlc').fill('2026-12-31');
  await page.locator('#consumptionModes').getByLabel('À emporter').check();
  await page.locator('#consumptionModes').getByLabel('Sur place').check();
  await page.getByRole('button', { name: 'Créer l’Article' }).click();

  await expect(page.getByRole('heading', { name: 'Chocolat noir' })).toBeVisible();
  await expect(page.locator('.article-detail').getByText(foodEan)).toBeVisible();
  await expect(articleDetailText('1000 centimes')).toBeVisible();
  await expect(page.getByText('takeaway, onsite')).toBeVisible();
  await expect(articleDetailText('1055 centimes')).toBeVisible();
  await expect(articleDetailText('1100 centimes')).toBeVisible();
  await expect(page.locator('#priceTtcCents')).toHaveCount(0);

  await page.locator('#detailPriceHtCents').fill('199');
  await page.getByRole('button', { name: 'Enregistrer le Prix HT' }).click();
  await expect(articleDetailText('210 centimes')).toBeVisible();
  await expect(articleDetailText('219 centimes')).toBeVisible();

  await page.locator('#detailDlc').fill('2027-01-31');
  await page.getByRole('button', { name: 'Enregistrer les attributs' }).click();
  await expect(articleDetailText('2027-01-31')).toBeVisible();

  await page.locator('#catalog-search').fill('chocolat');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(articleRow(foodEan)).toBeVisible();
  const activeDetailAction = articleRow(foodEan).getByRole('button', { name: 'Consulter Chocolat noir' });
  await activeDetailAction.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Chocolat noir' })).toBeVisible();

  await page.locator('#catalog-search').fill(foodEan);
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(articleRow(foodEan)).toBeVisible();
  const archiveAction = articleRow(foodEan).getByRole('button', { name: 'Archiver Chocolat noir' });
  await archiveAction.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#catalog-lifecycle-status')).toContainText('archivé');
  await expect(articleRow(foodEan)).toHaveCount(0);

  await page.locator('#catalog-status').selectOption('archived');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(articleRow(foodEan)).toBeVisible();

  await page.getByRole('button', { name: 'Consulter Chocolat noir' }).click();
  await expect(page.getByRole('heading', { name: 'Chocolat noir' })).toBeVisible();
  await expect(page.locator('.article-detail').getByText(foodEan)).toBeVisible();
  await expect(page.locator('section[aria-labelledby="lookup-title"]').getByText('Archivé', { exact: true })).toBeVisible();
  await expect(articleDetailText('Alimentaire')).toBeVisible();
  await expect(articleDetailText('199 centimes')).toBeVisible();
  await expect(articleDetailText('2027-01-31')).toBeVisible();
  await expect(articleDetailText('takeaway, onsite')).toBeVisible();

  await page.reload();
  await page.locator('#lookupEan13').fill(foodEan);
  await page.getByRole('button', { name: 'Consulter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Chocolat noir' })).toBeVisible();
  await expect(page.locator('.article-detail').getByText(foodEan)).toBeVisible();
  await expect(page.locator('section[aria-labelledby="lookup-title"]').getByText('Archivé', { exact: true })).toBeVisible();
  await expect(articleDetailText('Alimentaire')).toBeVisible();
  await expect(articleDetailText('199 centimes')).toBeVisible();
  await expect(articleDetailText('2027-01-31')).toBeVisible();
  await expect(articleDetailText('takeaway, onsite')).toBeVisible();

  await page.locator('#ean13').fill(foodEan);
  await page.locator('#name').fill('Doublon archivé');
  await page.locator('#priceHtCents').fill('1000');
  await page.locator('#dlc').fill('2026-12-31');
  await page.locator('#consumptionModes').getByLabel('À emporter').check();
  const reuseResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/articles';
  });
  await page.getByRole('button', { name: 'Créer l’Article' }).click();
  const reuseResponse = await reuseResponsePromise;
  expect(reuseResponse.status()).toBe(409);
  expect(reuseResponse.headers()['content-type']).toContain('application/problem+json');
  await expect(reuseResponse.json()).resolves.toMatchObject({
    code: 'article.ean13.conflict',
    errors: { ean13: expect.arrayContaining([expect.stringMatching(/\S+/)]) },
  });
  await expect(page.locator('#ean13-error')).toContainText('déjà');
  await expect(page.locator('#ean13')).toBeFocused();

  await page.locator('#catalog-search').fill(foodEan);
  await page.locator('#catalog-status').selectOption('archived');
  const archivedListResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname === '/api/articles'
      && url.searchParams.get('status') === 'archived'
      && url.searchParams.get('search') === foodEan;
  });
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  const archivedListResponse = await archivedListResponsePromise;
  const archivedArticles = await archivedListResponse.json() as Array<{ ean13: string }>;
  expect(archivedListResponse.status()).toBe(200);
  expect(archivedArticles).toHaveLength(1);
  expect(archivedArticles[0]?.ean13).toBe(foodEan);
  await expect(articleRow(foodEan)).toHaveCount(1);

  const reactivateAction = articleRow(foodEan).getByRole('button', { name: 'Réactiver Chocolat noir' });
  await reactivateAction.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#catalog-lifecycle-status')).toContainText('actif');
  await expect(articleRow(foodEan)).toHaveCount(0);

  await page.locator('#catalog-status').selectOption('active');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(articleRow(foodEan)).toBeVisible();

  await page.locator('#catalog-search').fill(foodEan);
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(articleRow(foodEan)).toBeVisible();

  await page.getByRole('button', { name: 'Consulter Chocolat noir' }).click();
  await expect(page.locator('section[aria-labelledby="lookup-title"]').getByText('Actif', { exact: true })).toBeVisible();
  await page.locator('#detailDlc').fill('2027-02-28');
  await page.getByRole('button', { name: 'Enregistrer les attributs' }).click();
  await expect(articleDetailText('2027-02-28')).toBeVisible();

  await page.reload();
  await page.locator('#lookupEan13').fill(foodEan);
  await page.getByRole('button', { name: 'Consulter', exact: true }).click();
  await expect(articleDetailText('2027-02-28')).toBeVisible();

  await page.locator('#catalog-search').fill('aucune référence');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.getByText('Aucun Article ne correspond à ces critères.')).toBeVisible();

  await page.locator('#catalog-search').fill('');
  await page.locator('#catalog-type').selectOption('food');
  await page.locator('#catalog-mode').selectOption('onsite');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(articleRow(foodEan)).toBeVisible();

  await page.reload();
  await page.locator('#lookupEan13').fill(foodEan);
  await page.getByRole('button', { name: 'Consulter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Chocolat noir' })).toBeVisible();
  await expect(page.getByText('2027-02-28')).toBeVisible();
  await expect(articleDetailText('210 centimes')).toBeVisible();
  await expect(articleDetailText('219 centimes')).toBeVisible();

  await page.locator('#ean13').fill(singleFoodEan);
  await page.locator('#name').fill('Café à emporter');
  await page.locator('#priceHtCents').fill('1000');
  await page.locator('#dlc').fill('2026-12-31');
  await page.locator('#consumptionModes').getByLabel('À emporter').check();
  await page.getByRole('button', { name: 'Créer l’Article' }).click();
  await expect(page.getByRole('heading', { name: 'Café à emporter' })).toBeVisible();
  await expect(page.locator('.price-quote')).toHaveCount(1);
  const singleFoodQuote = page.locator('.price-quote');
  await expect(singleFoodQuote).toContainText('À emporter');
  await expect(singleFoodQuote).toContainText('11/200');
  await expect(singleFoodQuote).toContainText('1055 centimes');
  await expect(singleFoodQuote).not.toContainText('Sur place');

  await page.reload();
  await page.locator('#lookupEan13').fill(singleFoodEan);
  await page.getByRole('button', { name: 'Consulter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Café à emporter' })).toBeVisible();
  await expect(page.locator('.price-quote')).toHaveCount(1);
  await expect(page.locator('.price-quote')).toContainText('À emporter');
  await expect(page.locator('.price-quote')).toContainText('11/200');
  await expect(page.locator('.price-quote')).toContainText('1055 centimes');

  await page.locator('#type').selectOption('nonFood');
  await expect(page.locator('#dlc')).toHaveCount(0);
  await expect(page.locator('#consumptionModes')).toHaveCount(0);
  await page.locator('#priceHtCents').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#packaging')).toBeFocused();
  await page.locator('#ean13').fill(nonFoodEan);
  await page.locator('#name').fill('Batterie reconditionnée');
  await page.locator('#priceHtCents').fill('2500');
  await page.locator('#packaging').selectOption('refurbished');
  await page.getByRole('button', { name: 'Créer l’Article' }).click();
  await expect(page.getByRole('heading', { name: 'Batterie reconditionnée' })).toBeVisible();
  await expect(articleDetailText('3000 centimes')).toBeVisible();

  await page.locator('#catalog-type').selectOption('nonFood');
  await page.locator('#catalog-packaging').selectOption('refurbished');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(articleRow(nonFoodEan)).toBeVisible();
  await expect(catalogPanel.getByRole('row', { name: /Lampe historique/ })).toHaveCount(0);

  await page.reload();
  await page.locator('#lookupEan13').fill(nonFoodEan);
  await page.getByRole('button', { name: 'Consulter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Batterie reconditionnée' })).toBeVisible();
  await expect(page.locator('.article-detail').getByText(nonFoodEan)).toBeVisible();
  await expect(page.locator('.article-detail').getByText('Non alimentaire', { exact: true })).toBeVisible();
  await expect(articleDetailText('2500 centimes')).toBeVisible();
  await expect(page.getByText('refurbished')).toBeVisible();
  await expect(articleDetailText('3000 centimes')).toBeVisible();
  await expect(page.locator('.price-quote')).toHaveCount(1);

  await page.locator('#detailPackaging').selectOption('unsellable');
  await page.getByRole('button', { name: 'Enregistrer les attributs' }).click();
  await expect(page.getByText('unsellable')).toBeVisible();

  await page.locator('#detailPriceHtCents').fill('1999');
  await page.getByRole('button', { name: 'Enregistrer le Prix HT' }).click();
  await expect(articleDetailText('1999 centimes')).toBeVisible();
  await expect(articleDetailText('2399 centimes')).toBeVisible();
  await expect(page.getByText('unsellable')).toBeVisible();

  await page.reload();
  await page.locator('#lookupEan13').fill(nonFoodEan);
  await page.getByRole('button', { name: 'Consulter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Batterie reconditionnée' })).toBeVisible();
  await expect(articleDetailText('1999 centimes')).toBeVisible();
  await expect(articleDetailText('2399 centimes')).toBeVisible();
  await expect(articleDetailText('400 centimes')).toBeVisible();
  await expect(page.getByText('unsellable')).toBeVisible();
  await expect(page.locator('.price-quote')).toHaveCount(1);

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
  await page.locator('#ean13').fill(nonFoodEan);
  await page.locator('#name').fill('Doublon');
  await page.locator('#priceHtCents').fill('2500');
  await page.locator('#packaging').selectOption('refurbished');
  await page.getByRole('button', { name: 'Créer l’Article' }).click();
  await expect(page.locator('#ean13-error')).toContainText('déjà');
  await expect(page.locator('#ean13')).toBeFocused();

  await page.screenshot({ path: 'artifacts/playwright/catalogue.png', fullPage: true });
});

test('recomputes sellable stock after food DLC and non-food packaging updates', async ({ page }) => {
  const foodEan = '0123456789012';
  const nonFoodEan = '4012345678901';
  const today = '2030-01-15';
  const yesterday = '2030-01-14';
  const detailStock = (quantity: number) => page.locator('.article-detail').getByText(`${quantity} unités`, { exact: true });

  await page.goto('/');
  await page.locator('#lookupEan13').fill(foodEan);
  await page.getByRole('button', { name: 'Consulter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'DLC de démonstration' })).toBeVisible();
  await page.locator('#detailDlc').fill(today);
  await page.getByRole('button', { name: 'Enregistrer les attributs' }).click();
  await expect(page.locator('#attribute-update-error')).toContainText('mis à jour');
  await expect(detailStock(8)).toHaveCount(2);

  await page.locator('#detailDlc').fill(yesterday);
  await page.getByRole('button', { name: 'Enregistrer les attributs' }).click();
  await expect(page.locator('#attribute-update-error')).toContainText('mis à jour');
  await expect(page.locator('.article-detail').getByText(yesterday, { exact: true })).toBeVisible();
  await expect(detailStock(8)).toHaveCount(1);
  await expect(detailStock(0)).toHaveCount(1);

  await page.locator('#lookupEan13').fill(nonFoodEan);
  await page.getByRole('button', { name: 'Consulter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Packaging de démonstration' })).toBeVisible();
  await page.locator('#detailPackaging').selectOption('new');
  await page.getByRole('button', { name: 'Enregistrer les attributs' }).click();
  await expect(page.locator('#attribute-update-error')).toContainText('mis à jour');
  await expect(detailStock(7)).toHaveCount(2);

  await page.locator('#detailPackaging').selectOption('unsellable');
  await page.getByRole('button', { name: 'Enregistrer les attributs' }).click();
  await expect(page.locator('#attribute-update-error')).toContainText('mis à jour');
  await expect(page.locator('.article-detail').getByText('unsellable', { exact: true })).toBeVisible();
  await expect(detailStock(7)).toHaveCount(1);
  await expect(detailStock(0)).toHaveCount(1);

  await page.reload();
  await page.locator('#lookupEan13').fill(nonFoodEan);
  await page.getByRole('button', { name: 'Consulter', exact: true }).click();
  await expect(detailStock(7)).toHaveCount(1);
  await expect(detailStock(0)).toHaveCount(1);
});

test('consults Stock positions, distinguishes blocked quantities and opens detail by keyboard', async ({ page }) => {
  const stockPanel = page.locator('#stock-panel');

  await page.goto('/');
  await expect(stockPanel.getByText(/Articles trouvés/)).toBeVisible();
  await expect(stockPanel.getByRole('row', { name: /DLC de démonstration/ })).toContainText('0123456789012');
  await expect(stockPanel.getByRole('row', { name: /DLC de démonstration/ })).toContainText('8 unités');
  await expect(stockPanel.getByRole('row', { name: /Alimentaire expiré/ })).toContainText('7 unités');
  await expect(stockPanel.getByRole('row', { name: /Alimentaire expiré/ })).toContainText('DLC dépassée');
  await expect(stockPanel.getByRole('row', { name: /Biscuit historique/ })).toContainText('4 unités');
  await expect(stockPanel.getByRole('row', { name: /Biscuit historique/ })).toContainText('Article archivé');
  await expect(stockPanel.getByRole('row', { name: /^Packaging invendable / })).toContainText('3 unités');
  await expect(stockPanel.getByRole('row', { name: /^Packaging invendable / })).toContainText('Packaging invendable');
  await expect(stockPanel.getByRole('row', { name: /Article sans position/ })).toContainText('0 unités');
  await expect(stockPanel.getByRole('row', { name: /Article sans position/ })).toContainText('Rupture');

  const expiredDetail = stockPanel.getByRole('button', { name: 'Consulter le détail du Stock de Alimentaire expiré' });
  await expiredDetail.focus();
  await page.keyboard.press('Enter');
  await expect(stockPanel.getByRole('heading', { name: /Détail du Stock — Alimentaire expiré/ })).toBeVisible();
  await expect(stockPanel.locator('#stock-detail')).toContainText('7 unités');
  await expect(stockPanel.locator('#stock-detail')).toContainText('0 unités');
  await expect(stockPanel.locator('#stock-detail')).toContainText('DLC dépassée');

  await page.reload();
  const reloadedStockPanel = page.locator('#stock-panel');
  await expect(reloadedStockPanel.getByRole('row', { name: /Alimentaire expiré/ })).toContainText('DLC dépassée');
  const reloadedExpiredDetail = reloadedStockPanel.getByRole('button', { name: 'Consulter le détail du Stock de Alimentaire expiré' });
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
  const navigation = page.goto('/');
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

test('recovers a failed catalogue request and opens detail with the keyboard', async ({ page }) => {
  const catalogPanel = page.locator('section[aria-labelledby="catalog-title"]');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Créer et consulter un Article' })).toBeVisible();

  await page.locator('#catalog-status').selectOption('archived');
  await page.locator('#catalog-search').fill('Biscuit');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(catalogPanel.getByRole('row', { name: /Biscuit historique/ })).toBeVisible();

  const detailAction = page.getByRole('button', { name: 'Consulter Biscuit historique' });
  await detailAction.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Biscuit historique' })).toBeVisible();

  let failCatalogueRequest = true;
  const catalogueRoute = async (route: Route) => {
    const requestUrl = new URL(route.request().url());
    if (failCatalogueRequest && requestUrl.searchParams.get('search') === 'Biscuit') {
      await route.abort();
      return;
    }
    await route.continue();
  };
  await page.route(/\/api\/articles\?.*/, catalogueRoute);

  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Catalogue');
  await expect(page.locator('#catalog-stale')).toContainText('recherche précédente');
  await expect(catalogPanel.getByRole('row', { name: /Biscuit historique/ })).toBeVisible();

  failCatalogueRequest = false;
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect(page.locator('#catalog-state')).toContainText('1 Article trouvé.');
  await expect(page.locator('#catalog-stale')).toHaveCount(0);
  await page.unroute(/\/api\/articles\?.*/, catalogueRoute);
});
