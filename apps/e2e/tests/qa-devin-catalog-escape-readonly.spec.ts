import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test.skip(process.env['KALIO_DEVIN_CATALOG_ESCAPE'] !== '1', 'Explicit fixed QA read-only settings audit');
test('nested catalog Escape preserves settings and returns focus', async ({ page }) => {
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-settings').click();
  await page.getByRole('button', { name: 'Agent runtimes', exact: true }).click();
  const opener = page.getByRole('button', { name: /^Browse \d+ models$/ });
  await opener.click();
  const catalog = page.getByRole('dialog', { name: 'Devin models', exact: true });
  await expect(catalog).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'Search Devin models' });
  await search.fill('swe-2');
  await expect(catalog.getByText('swe-2', { exact: true })).toBeVisible();
  await search.press('Escape');
  await expect(catalog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close settings' })).toBeVisible();
  await expect(opener).toBeFocused();
  await page.screenshot({ path: resolve(__dirname, '../../../apps/e2e/outputs/qa-run-173/assets/settings-after-catalog-escape.png') });
  await opener.press('Escape');
  await expect(page.getByRole('button', { name: 'Close settings' })).toHaveCount(0);
});
