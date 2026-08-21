import { expect, Route, test } from '@playwright/test';

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
  const articleRow = (ean13: string) => page.getByRole('row', { name: new RegExp(ean13) });
  const articleDetailText = (text: string) => page.locator('.article-detail').getByText(text);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Créer et consulter un Article' })).toBeVisible();
  await page.locator('#catalog-search').fill(foodEan);
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.getByText('Aucun Article ne correspond à ces critères.')).toBeVisible();
  await page.locator('#catalog-search').fill('');

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
  await expect(page.getByRole('row', { name: /Lampe historique/ })).toHaveCount(0);

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

test('recovers a failed catalogue request and opens detail with the keyboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Créer et consulter un Article' })).toBeVisible();

  await page.locator('#catalog-status').selectOption('archived');
  await page.locator('#catalog-search').fill('Biscuit');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.getByRole('row', { name: /Biscuit historique/ })).toBeVisible();

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
  await expect(page.getByRole('row', { name: /Biscuit historique/ })).toBeVisible();

  failCatalogueRequest = false;
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect(page.locator('#catalog-state')).toContainText('1 Article trouvé.');
  await expect(page.locator('#catalog-stale')).toHaveCount(0);
  await page.unroute(/\/api\/articles\?.*/, catalogueRoute);
});
