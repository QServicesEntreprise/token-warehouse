import { expect } from '@playwright/test';
import { test } from './fixtures';

const routes = [
  { path: '/dashboard', section: 'dashboard', link: 'Dashboard' },
  { path: '/catalogue', section: 'catalogue', link: 'Catalogue' },
  { path: '/stock', section: 'stock', link: 'Stock' },
  { path: '/stock/approvisionnements', section: 'approvisionnements', link: 'Approvisionnement' },
  { path: '/stock/inventaires', section: 'inventaires', link: 'Inventaire' },
  { path: '/stock/corrections', section: 'corrections', link: 'Contre-mouvement' },
  { path: '/stock/historique', section: 'historique', link: 'Historique' },
  { path: '/ventes', section: 'ventes', link: 'Vente' },
] as const;

test('opens every section directly and restores navigation history', async ({ page }) => {
  for (const route of routes) {
    await page.goto(route.path);
    await expect(page).toHaveURL(new RegExp(`${route.path.replaceAll('/', '\\/')}$`));
    await expect(page.locator('main[data-route-section]')).toHaveAttribute('data-route-section', route.section);
    await expect(page.getByRole('link', { name: route.link, exact: true })).toHaveAttribute('aria-current', 'page');

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`${route.path.replaceAll('/', '\\/')}$`));
    await expect(page.locator('main[data-route-section]')).toHaveAttribute('data-route-section', route.section);
    await expect(page.getByRole('link', { name: route.link, exact: true })).toHaveAttribute('aria-current', 'page');
  }

  await page.goto('/dashboard');
  const catalogueLink = page.getByRole('link', { name: 'Catalogue', exact: true });
  await catalogueLink.focus();
  await expect(catalogueLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/catalogue$/);
  await expect(page.locator('main[data-route-section]')).toHaveAttribute('data-route-section', 'catalogue');

  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('main[data-route-section]')).toHaveAttribute('data-route-section', 'dashboard');

  await page.goForward();
  await expect(page).toHaveURL(/\/catalogue$/);
  await expect(page.locator('main[data-route-section]')).toHaveAttribute('data-route-section', 'catalogue');
});
