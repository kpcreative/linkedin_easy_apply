import { test, expect } from '@playwright/test';

test.describe('Playwright documentation site', () => {
  test('homepage has correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Playwright/);
  });

  test('Get Started link navigates to intro page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Get started' }).first().click();
    await expect(page).toHaveURL(/.*intro/);
    await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible();
  });

  test('search button is accessible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  });
});
