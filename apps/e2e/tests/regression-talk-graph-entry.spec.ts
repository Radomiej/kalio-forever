import { expect, test } from '@playwright/test';

test.describe('Talk graph entry', () => {
  test('graph view is reachable from Talk without starting a conversation first', async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.clear();
    });

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    const graphEntry = page.getByTestId('talk-sidebar-graph-entry');
    await expect(graphEntry).toBeVisible({ timeout: 5000 });
    await graphEntry.click();

    await expect(page.getByTestId('execution-graph-view')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('heading', { name: 'Execution Graph' })).toBeVisible({ timeout: 5000 });
  });
});