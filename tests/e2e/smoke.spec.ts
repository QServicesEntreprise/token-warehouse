import { expect, test } from '@playwright/test';

test('renders the real shell while the real API is orchestrated', async ({ page, request }) => {
  const apiResponse = await request.get('http://127.0.0.1:5100/health');
  expect(apiResponse.ok()).toBeTruthy();
  expect((await apiResponse.json()).provider).toBe('sqlite');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Token Warehouse' })).toBeVisible();
  await expect(page.getByText('Technical shell')).toBeVisible();
  await page.screenshot({ path: 'artifacts/playwright/shell.png', fullPage: true });
});
