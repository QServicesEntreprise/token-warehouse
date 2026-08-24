import { expect } from '@playwright/test';
import { test } from './fixtures';

const routes = [
  { path: '/dashboard', target: '#dashboard-title', link: 'Dashboard' },
  { path: '/catalogue', target: '#catalog-title', link: 'Catalogue' },
  { path: '/stock', target: '#stock-title', link: 'Stock' },
  { path: '/stock/approvisionnements', target: '#supply-title', link: 'Approvisionnement' },
  { path: '/stock/inventaires', target: '#inventory-title', link: 'Inventaire' },
  { path: '/stock/corrections', target: '#counter-movement-title', link: 'Contre-mouvement' },
  { path: '/stock/historique', target: '#history-title', link: 'Historique' },
  { path: '/ventes', target: '#sale-title', link: 'Vente' },
] as const;

test('opens every section directly and restores navigation history', async ({ page }) => {
  for (const route of routes) {
    await page.goto(route.path, { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(new RegExp(`${route.path.replaceAll('/', '\\/')}$`));
    await expect(page.locator(route.target)).toBeInViewport();
    await expect(page.getByRole('link', { name: route.link, exact: true })).toHaveAttribute('aria-current', 'page');

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page).toHaveURL(new RegExp(`${route.path.replaceAll('/', '\\/')}$`));
    await expect(page.locator(route.target)).toBeInViewport();
    await expect(page.getByRole('link', { name: route.link, exact: true })).toHaveAttribute('aria-current', 'page');
  }

  await page.goto('/dashboard');
  const catalogueLink = page.getByRole('link', { name: 'Catalogue', exact: true });
  await catalogueLink.focus();
  await expect(catalogueLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/catalogue$/);
  await expect(page.locator('#catalog-title')).toBeInViewport();

  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('#dashboard-title')).toBeInViewport();

  await page.goForward();
  await expect(page).toHaveURL(/\/catalogue$/);
  await expect(page.locator('#catalog-title')).toBeInViewport();
});
