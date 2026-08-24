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
    await expect(page.locator(route.target)).toBeFocused();
    await expect(page.getByRole('link', { name: route.link, exact: true })).toHaveAttribute('aria-current', 'page');

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page).toHaveURL(new RegExp(`${route.path.replaceAll('/', '\\/')}$`));
    await expect(page.locator(route.target)).toBeInViewport();
    await expect(page.locator(route.target)).toBeFocused();
    await expect(page.getByRole('link', { name: route.link, exact: true })).toHaveAttribute('aria-current', 'page');
  }

  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  for (const route of routes.slice(1)) {
    const link = page.getByRole('link', { name: route.link, exact: true });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${route.path.replaceAll('/', '\\/')}$`));
    await expect(page.locator(route.target)).toBeInViewport();
    await expect(page.locator(route.target)).toBeFocused();
  }

  for (const route of [...routes.slice(0, -1)].reverse()) {
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${route.path.replaceAll('/', '\\/')}$`));
    await expect(page.locator(route.target)).toBeInViewport();
    await expect(page.locator(route.target)).toBeFocused();
  }

  for (const route of routes.slice(1)) {
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`${route.path.replaceAll('/', '\\/')}$`));
    await expect(page.locator(route.target)).toBeInViewport();
    await expect(page.locator(route.target)).toBeFocused();
  }
});

test('keeps an unsubmitted Catalogue filter while visiting another section', async ({ page }) => {
  await page.goto('/catalogue');
  await page.locator('#catalog-search').fill('brouillon conservé');

  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('link', { name: 'Catalogue', exact: true }).click();
  await expect(page.locator('#catalog-search')).toHaveValue('brouillon conservé');
});
