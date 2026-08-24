import { expect, type Page, type Route } from '@playwright/test';
import { apiUrl as apiBaseUrl, test } from './fixtures';
import { ean13ForAttempt, invalidChecksumEan13 } from './helpers/ean13';
import { expectProblemDetails, waitForRequest } from './helpers/http';
import { createFoodArticle, createNonFoodArticle, supply } from './helpers/state';

const validEan13 = ean13ForAttempt('650000000', 0);

const foodPayload = (ean13: string): Record<string, unknown> => ({
  ean13,
  type: 'food',
  name: 'Article alimentaire refusé',
  priceHtCents: 1000,
  dlc: '2030-12-31',
  consumptionModes: ['takeaway'],
});

const nonFoodPayload = (ean13: string): Record<string, unknown> => ({
  ean13,
  type: 'nonFood',
  name: 'Article non alimentaire refusé',
  priceHtCents: 2500,
  packaging: 'new',
});

const expectCreationRefused = async (
  page: Page,
  payload: Record<string, unknown>,
  fields: readonly string[],
): Promise<void> => {
  const response = await page.request.post(`${apiBaseUrl}/api/articles`, { data: payload });
  await expectProblemDetails(response, { status: 400, code: 'article.validation', fields });

  const listResponse = await page.request.get(
    `${apiBaseUrl}/api/articles?status=all&search=${encodeURIComponent(String(payload['ean13']))}`,
  );
  expect(listResponse.status()).toBe(200);
  expect(await listResponse.json()).toEqual([]);
};

test('recherche le Catalogue et conserve une intersection vide de trois filtres', async ({ page }, testInfo) => {
  const attempt = testInfo.repeatEachIndex * (testInfo.project.retries + 1) + testInfo.retry;
  const foodEan = ean13ForAttempt('012345678', attempt);
  const nonFoodEan = ean13ForAttempt('400638133', attempt);
  await createFoodArticle(page, {
    ean13: foodEan,
    name: 'Chocolat noir',
    modes: ['takeaway', 'onsite'],
    dlc: '2027-02-28',
    priceHtCents: 199,
  });
  await createNonFoodArticle(page, {
    ean13: nonFoodEan,
    name: 'Batterie reconditionnée',
    packaging: 'refurbished',
    priceHtCents: 2500,
  });
  const catalogPanel = page.locator('section[aria-labelledby="catalog-title"]');
  const articleRow = (ean13: string) => catalogPanel.getByRole('row', { name: new RegExp(ean13) });

  await page.goto('/catalogue');
  await expect(page.getByRole('heading', { name: 'Catalogue', exact: true })).toBeVisible();
  await page.locator('#catalog-search').fill(ean13ForAttempt('650000001', attempt));
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.getByText('Aucun Article ne correspond à ces critères.')).toBeVisible();
  await page.locator('#catalog-search').fill('');

  await page.locator('#catalog-status').selectOption('archived');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(catalogPanel.getByRole('row', { name: /Article archivé/ })).toBeVisible();
  await page.getByRole('button', { name: 'Consulter Article archivé' }).click();
  await expect(page.getByRole('heading', { name: 'Article archivé' })).toBeVisible();
  await expect(page.locator('section[aria-labelledby="lookup-title"]').getByText('Archivé', { exact: true })).toBeVisible();
  await page.goBack();

  await page.locator('#catalog-status').selectOption('all');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(catalogPanel.getByRole('row', { name: /Article archivé/ })).toBeVisible();

  await page.locator('#catalog-status').selectOption('active');
  await page.locator('#catalog-search').fill('chocolat');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(articleRow(foodEan)).toBeVisible();
  const activeDetailAction = articleRow(foodEan).getByRole('button', { name: 'Consulter Chocolat noir' });
  await activeDetailAction.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Chocolat noir' })).toBeVisible();
  await page.goBack();

  await page.locator('#catalog-search').fill(foodEan);
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(articleRow(foodEan)).toBeVisible();

  await page.locator('#catalog-search').fill('aucune référence');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.getByText('Aucun Article ne correspond à ces critères.')).toBeVisible();

  await page.locator('#catalog-search').fill('');
  await page.locator('#catalog-type').selectOption('food');
  await page.locator('#catalog-mode').selectOption('onsite');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(articleRow(foodEan)).toBeVisible();

  await page.locator('#catalog-search').fill('Batterie');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.getByText('Aucun Article ne correspond à ces critères.')).toBeVisible();
  await expect(page.locator('#catalog-search')).toHaveValue('Batterie');
  await expect(page.locator('#catalog-type')).toHaveValue('food');
  await expect(page.locator('#catalog-mode')).toHaveValue('onsite');

  await page.locator('#catalog-search').fill('');
  await page.locator('#catalog-type').selectOption('nonFood');
  await page.locator('#catalog-packaging').selectOption('refurbished');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(articleRow(nonFoodEan)).toBeVisible();
  await expect(catalogPanel.getByRole('row', { name: /Article archivé/ })).toHaveCount(0);
});

test('crée les trois formes d’Article et initialise leurs Stocks à zéro', async ({ page }, testInfo) => {
  const attempt = testInfo.repeatEachIndex * (testInfo.project.retries + 1) + testInfo.retry;
  const foodEan = ean13ForAttempt('012345678', attempt);
  const singleFoodEan = ean13ForAttempt('012345670', attempt);
  const nonFoodEan = ean13ForAttempt('400638133', attempt);
  const articleDetailText = (text: string) => page.locator('.article-detail').getByText(text);

  await page.goto('/catalogue');
  await expect(page.getByRole('row', { name: new RegExp(foodEan) })).toHaveCount(0);
  await page.getByRole('link', { name: 'Créer un Article' }).click();
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
  await expect(page.locator('.price-quote')).toHaveCount(2);
  await expect(page.locator('.price-quotes')).toContainText('11/200');
  await expect(page.locator('.price-quotes')).toContainText('1/10');
  await expect(page.locator('#priceTtcCents')).toHaveCount(0);
  await expect(page.locator('.article-detail').getByText('0 unités', { exact: true })).toHaveCount(2);
  await page.getByRole('link', { name: 'Catalogue', exact: true }).click();
  await expect(page.getByRole('row', { name: new RegExp(foodEan) })).toBeVisible();
  await page.goto('/stock');
  const stockRow = page.locator('#stock-panel').getByRole('row', { name: /Chocolat noir/ });
  await expect(stockRow).toBeVisible();
  await expect(stockRow.getByRole('cell', { name: '0 unités', exact: true })).toHaveCount(3);

  await page.goto('/catalogue/nouveau');
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
  await expect(page.getByRole('heading', { name: 'Café à emporter' })).toBeVisible();
  await expect(page.locator('.price-quote')).toHaveCount(1);
  await expect(page.locator('.price-quote')).toContainText('À emporter');
  await expect(page.locator('.price-quote')).toContainText('11/200');
  await expect(page.locator('.price-quote')).toContainText('1055 centimes');

  await page.goto('/catalogue/nouveau');
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

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Batterie reconditionnée' })).toBeVisible();
  await expect(page.locator('.article-detail').getByText(nonFoodEan)).toBeVisible();
  await expect(page.locator('.article-detail').getByText('Non alimentaire', { exact: true })).toBeVisible();
  await expect(articleDetailText('2500 centimes')).toBeVisible();
  await expect(page.getByText('refurbished')).toBeVisible();
  await expect(articleDetailText('3000 centimes')).toBeVisible();
  await expect(page.locator('.price-quote')).toHaveCount(1);
  await expect(page.locator('.price-quote')).toContainText('1/5');
  await expect(page.locator('.price-quote')).toContainText('500 centimes');

  await page.goto('/catalogue/nouveau');
  await page.locator('#type').selectOption('food');
  await page.locator('#ean13').fill(invalidChecksumEan13);
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

test('modifie le Prix HT et retrouve les changements de DLC et Packaging dans l’Historique', async ({ page }, testInfo) => {
  const attempt = testInfo.repeatEachIndex * (testInfo.project.retries + 1) + testInfo.retry;
  const foodEan = ean13ForAttempt('650000002', attempt);
  const nonFoodEan = ean13ForAttempt('650000003', attempt);
  await createFoodArticle(page, {
    ean13: foodEan,
    name: 'Chocolat noir',
    modes: ['takeaway', 'onsite'],
    dlc: '2030-12-31',
    priceHtCents: 1000,
  });
  await createNonFoodArticle(page, {
    ean13: nonFoodEan,
    name: 'Batterie reconditionnée',
    packaging: 'refurbished',
    priceHtCents: 2500,
  });
  const articleDetailText = (text: string) => page.locator('.article-detail').getByText(text);

  await page.goto(`/catalogue/${foodEan}`);
  await page.locator('#detailPriceHtCents').fill('199');
  await page.getByRole('button', { name: 'Enregistrer le Prix HT' }).click();
  await expect(articleDetailText('210 centimes')).toBeVisible();
  await expect(articleDetailText('219 centimes')).toBeVisible();

  await page.locator('#detailPriceHtCents').fill('-1');
  const negativePatchPromise = waitForRequest(page, 'PATCH', `/api/articles/${foodEan}`);
  await page.getByRole('button', { name: 'Enregistrer le Prix HT' }).click();
  await expectProblemDetails(await negativePatchPromise, {
    status: 400,
    code: 'article.validation',
    fields: ['priceHtCents'],
  });
  await expect(articleDetailText('199 centimes')).toBeVisible();

  await page.locator('#detailDlc').fill('2027-01-31');
  await page.getByRole('button', { name: 'Enregistrer les attributs' }).click();
  await expect(articleDetailText('2027-01-31')).toBeVisible();
  await page.goto('/stock/historique');
  await page.locator('#history-ean13').fill(foodEan);
  await page.getByRole('button', { name: 'Filtrer l’Historique', exact: true }).click();
  await expect(page.locator('#history-list')).toContainText('Changement de DLC');
  await expect(page.locator('#history-list')).toContainText('dlc : 2030-12-31 → 2027-01-31');

  await page.goto(`/catalogue/${foodEan}`);
  await expect(page.getByRole('heading', { name: 'Chocolat noir' })).toBeVisible();
  await expect(articleDetailText('2027-01-31')).toBeVisible();
  await expect(articleDetailText('takeaway, onsite')).toBeVisible();
  await expect(articleDetailText('210 centimes')).toBeVisible();
  await expect(articleDetailText('219 centimes')).toBeVisible();

  await page.reload();
  await expect(articleDetailText('2027-01-31')).toBeVisible();
  await expect(articleDetailText('takeaway, onsite')).toBeVisible();

  await page.goto(`/catalogue/${nonFoodEan}`);
  await page.locator('#detailPackaging').selectOption('unsellable');
  await page.getByRole('button', { name: 'Enregistrer les attributs' }).click();
  await expect(page.getByText('unsellable')).toBeVisible();
  await page.locator('#detailPriceHtCents').fill('1999');
  await page.getByRole('button', { name: 'Enregistrer le Prix HT' }).click();
  await expect(articleDetailText('1999 centimes')).toBeVisible();
  await expect(articleDetailText('2399 centimes')).toBeVisible();
  await expect(page.getByText('unsellable')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Batterie reconditionnée' })).toBeVisible();
  await expect(articleDetailText('1999 centimes')).toBeVisible();
  await expect(articleDetailText('2399 centimes')).toBeVisible();
  await expect(articleDetailText('400 centimes')).toBeVisible();
  await expect(page.getByText('unsellable')).toBeVisible();
  await expect(page.locator('.price-quote')).toHaveCount(1);
  await page.goto('/stock/historique');
  await page.locator('#history-ean13').fill(nonFoodEan);
  await page.getByRole('button', { name: 'Filtrer l’Historique', exact: true }).click();
  await expect(page.locator('#history-list')).toContainText('Changement de Packaging');
  await expect(page.locator('#history-list')).toContainText('packaging : refurbished → unsellable');
});

test('refuse les opérations et le Prix HT sur un Article archivé puis autorise sa modification réactivée', async ({ page }, testInfo) => {
  const attempt = testInfo.repeatEachIndex * (testInfo.project.retries + 1) + testInfo.retry;
  const foodEan = ean13ForAttempt('650000004', attempt);
  await createFoodArticle(page, {
    ean13: foodEan,
    name: 'Chocolat noir',
    modes: ['takeaway'],
    dlc: '2030-12-31',
    priceHtCents: 199,
  });
  await supply(page, foodEan, 4);
  const catalogPanel = page.locator('section[aria-labelledby="catalog-title"]');
  const articleRow = (ean13: string) => catalogPanel.getByRole('row', { name: new RegExp(ean13) });
  const articleDetailText = (text: string) => page.locator('.article-detail').getByText(text);

  await page.goto('/catalogue');
  await page.locator('#catalog-search').fill(foodEan);
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(articleRow(foodEan)).toBeVisible();
  const archiveAction = articleRow(foodEan).getByRole('button', { name: 'Archiver Chocolat noir' });
  await archiveAction.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#catalog-lifecycle-status')).toContainText('archivé');
  await expect(page.locator('#catalog-lifecycle-status')).toBeFocused();
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
  await expect(articleDetailText('2030-12-31')).toBeVisible();
  await expect(articleDetailText('takeaway')).toBeVisible();
  await expect(page.locator('.article-detail').getByText('4 unités', { exact: true })).toHaveCount(1);
  await expect(page.locator('.article-detail').getByText('0 unités', { exact: true })).toHaveCount(1);

  await expectProblemDetails(
    await page.request.patch(`${apiBaseUrl}/api/articles/${foodEan}`, { data: { priceHtCents: 299 } }),
    { status: 409, code: 'article.priceHt.conflict', fields: ['priceHtCents'] },
  );
  await expectProblemDetails(
    await page.request.post(`${apiBaseUrl}/api/supplies`, { data: { ean13: foodEan, quantity: 1 } }),
    { status: 409, code: 'article_archived', fields: ['ean13'] },
  );
  await expectProblemDetails(
    await page.request.post(`${apiBaseUrl}/api/sales`, { data: { ean13: foodEan, quantity: 1 } }),
    { status: 409, code: 'NOT_SELLABLE' },
  );

  await page.goto('/stock');
  const stockRow = page.locator('#stock-panel').getByRole('row', { name: /Chocolat noir/ });
  await expect(stockRow).toContainText('4 unités');
  await expect(stockRow).toContainText('0 unités');
  await expect(stockRow).toContainText('Article archivé');
  await page.goto(`/catalogue/${foodEan}`);
  await expect(page.getByRole('heading', { name: 'Chocolat noir' })).toBeVisible();
  await expect(page.locator('.article-detail').getByText(foodEan)).toBeVisible();
  await expect(page.locator('section[aria-labelledby="lookup-title"]').getByText('Archivé', { exact: true })).toBeVisible();
  await expect(articleDetailText('Alimentaire')).toBeVisible();
  await expect(articleDetailText('199 centimes')).toBeVisible();
  await expect(articleDetailText('2030-12-31')).toBeVisible();
  await expect(articleDetailText('takeaway')).toBeVisible();

  await page.goto('/catalogue/nouveau');
  await page.locator('#ean13').fill(foodEan);
  await page.locator('#name').fill('Doublon archivé');
  await page.locator('#priceHtCents').fill('1000');
  await page.locator('#dlc').fill('2026-12-31');
  await page.locator('#consumptionModes').getByLabel('À emporter').check();
  const reuseResponsePromise = waitForRequest(page, 'POST', '/api/articles');
  await page.getByRole('button', { name: 'Créer l’Article' }).click();
  const reuseResponse = await reuseResponsePromise;
  await expectProblemDetails(reuseResponse, {
    status: 409,
    code: 'article.ean13.conflict',
    fields: ['ean13'],
  });
  await expect(page.locator('#ean13-error')).toContainText('déjà');
  await expect(page.locator('#ean13')).toBeFocused();

  await page.goto('/catalogue');
  await page.locator('#catalog-search').fill(foodEan);
  await page.locator('#catalog-status').selectOption('archived');
  const archivedListResponsePromise = waitForRequest(page, 'GET', '/api/articles', (url) => (
    url.searchParams.get('status') === 'archived'
      && url.searchParams.get('search') === foodEan
  ));
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  const archivedListResponse = await archivedListResponsePromise;
  const archivedArticles = await archivedListResponse.json() as Array<{ ean13: string }>;
  expect(archivedListResponse.status()).toBe(200);
  expect(archivedArticles).toHaveLength(1);
  expect(archivedArticles[0]?.ean13).toBe(foodEan);
  await expect(articleRow(foodEan)).toHaveCount(1);

  await page.locator('#catalog-status').selectOption('all');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(articleRow(foodEan)).toBeVisible();
  await page.locator('#catalog-status').selectOption('archived');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  const reactivateAction = articleRow(foodEan).getByRole('button', { name: 'Réactiver Chocolat noir' });
  await reactivateAction.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#catalog-lifecycle-status')).toContainText('actif');
  await expect(page.locator('#catalog-lifecycle-status')).toBeFocused();
  await expect(articleRow(foodEan)).toHaveCount(0);

  await page.locator('#catalog-status').selectOption('active');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(articleRow(foodEan)).toBeVisible();
  await page.getByRole('button', { name: 'Consulter Chocolat noir' }).click();
  await expect(page.locator('section[aria-labelledby="lookup-title"]').getByText('Actif', { exact: true })).toBeVisible();
  await page.locator('#detailDlc').fill('2027-02-28');
  await page.getByRole('button', { name: 'Enregistrer les attributs' }).click();
  await expect(articleDetailText('2027-02-28')).toBeVisible();
  await page.locator('#detailPriceHtCents').fill('299');
  await page.getByRole('button', { name: 'Enregistrer le Prix HT' }).click();
  await expect(articleDetailText('299 centimes')).toBeVisible();

  await page.reload();
  await expect(articleDetailText('2027-02-28')).toBeVisible();
  await expect(page.getByText('2027-02-28')).toBeVisible();
});

test('récupère une requête Catalogue en échec et ouvre le détail au clavier', async ({ page }) => {
  const catalogPanel = page.locator('section[aria-labelledby="catalog-title"]');

  await page.goto('/catalogue');
  await expect(page.getByRole('heading', { name: 'Catalogue', exact: true })).toBeVisible();
  await page.locator('#catalog-status').selectOption('archived');
  await page.locator('#catalog-search').fill('Article archivé');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(catalogPanel.getByRole('row', { name: /Article archivé/ })).toBeVisible();

  const detailAction = page.getByRole('button', { name: 'Consulter Article archivé' });
  await detailAction.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Article archivé' })).toBeVisible();
  await page.goBack();
  await page.locator('#catalog-status').selectOption('archived');
  await page.locator('#catalog-search').fill('Article archivé');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(catalogPanel.getByRole('row', { name: /Article archivé/ })).toBeVisible();

  let failCatalogueRequest = true;
  const catalogueRoute = async (route: Route) => {
    const requestUrl = new URL(route.request().url());
    if (failCatalogueRequest && requestUrl.searchParams.get('search') === 'Article archivé') {
      await route.abort();
      return;
    }
    await route.continue();
  };
  await page.route(/\/api\/articles\?.*/, catalogueRoute);

  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(catalogPanel.getByRole('alert')).toContainText('Catalogue');
  await expect(page.locator('#catalog-stale')).toContainText('recherche précédente');
  await expect(catalogPanel.getByRole('row', { name: /Article archivé/ })).toBeVisible();

  failCatalogueRequest = false;
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect(page.locator('#catalog-state')).toContainText('1 Article trouvé.');
  await expect(page.locator('#catalog-stale')).toHaveCount(0);
  await page.unroute(/\/api\/articles\?.*/, catalogueRoute);
});

test('refuse un EAN-13 qui ne contient pas 13 chiffres sans créer d’Article', async ({ page }) => {
  await expectCreationRefused(page, foodPayload('123456789012'), ['ean13']);
});

test('refuse un nom absent sans créer d’Article', async ({ page }) => {
  const payload = foodPayload(validEan13);
  delete payload['name'];
  await expectCreationRefused(page, payload, ['name']);
});

test('refuse un Prix HT absent sans créer d’Article', async ({ page }) => {
  const payload = foodPayload(validEan13);
  delete payload['priceHtCents'];
  await expectCreationRefused(page, payload, ['priceHtCents']);
});

test('refuse une DLC manquante sans créer d’Article', async ({ page }) => {
  const payload = foodPayload(validEan13);
  delete payload['dlc'];
  await expectCreationRefused(page, payload, ['dlc']);
});

test('refuse une DLC invalide sans créer d’Article', async ({ page }) => {
  await expectCreationRefused(page, { ...foodPayload(validEan13), dlc: '2030-02-30' }, ['dlc']);
});

test('refuse un mode de consommation inconnu sans créer d’Article', async ({ page }) => {
  await expectCreationRefused(page, { ...foodPayload(validEan13), consumptionModes: ['driveThrough'] }, ['consumptionModes']);
});

test('refuse un mode de consommation dupliqué sans créer d’Article', async ({ page }) => {
  await expectCreationRefused(page, { ...foodPayload(validEan13), consumptionModes: ['takeaway', 'takeaway'] }, ['consumptionModes']);
});

test('refuse un Packaging absent sans créer d’Article', async ({ page }) => {
  const payload = nonFoodPayload(validEan13);
  delete payload['packaging'];
  await expectCreationRefused(page, payload, ['packaging']);
});

test('refuse un Packaging inconnu sans créer d’Article', async ({ page }) => {
  await expectCreationRefused(page, { ...nonFoodPayload(validEan13), packaging: 'damaged' }, ['packaging']);
});

test('refuse une DLC sur un Article non alimentaire sans créer d’Article', async ({ page }) => {
  await expectCreationRefused(page, { ...nonFoodPayload(validEan13), dlc: '2030-12-31' }, ['dlc']);
});

test('refuse un Prix HT négatif sans créer d’Article', async ({ page }) => {
  await expectCreationRefused(page, { ...foodPayload(validEan13), priceHtCents: -5000 }, ['priceHtCents']);
});
