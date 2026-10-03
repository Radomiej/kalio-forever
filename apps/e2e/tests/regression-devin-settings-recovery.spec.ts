import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

for (const action of ['policy', 'token'] as const) {
  test(`Devin ${action} partial-failure fixture reloads settings without repeating the write`, async ({ page }) => {
    let writes = 0;
    await page.route('**/api/runtime/devin-cli/settings', async (route) => {
      if (route.request().method() === 'PATCH') {
        writes++;
        await route.fulfill({ status: 500, json: { message: 'QA fixture: host reset failed' } });
        return;
      }
      await route.fulfill({ json: {
        mcpBridge: { enabled: true, configuredBy: 'settings', transport: 'streamable-http', url: 'http://fixture.invalid/mcp' },
        nativeTools: { filesystem: writes > 0, web: false, terminal: false, source: 'settings' },
      } });
    });
    await page.goto('/');
    await page.getByTestId('nav-settings').click();
    await page.getByRole('button', { name: 'Agent runtimes', exact: true }).click();
    const filesystem = page.getByRole('checkbox', { name: 'Allow Devin filesystem tools', exact: true });
    await expect(filesystem).not.toBeChecked();
    if (action === 'policy') await filesystem.click();
    else await page.getByRole('button', { name: 'Generate local token', exact: true }).click();
    await expect(filesystem).toBeChecked();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('QA fixture: host reset failed');
    await expect(alert).toContainText('Persisted settings reloaded');
    await expect(page.getByTestId('native-integration-notice')).toHaveCount(0);
    expect(writes).toBe(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await alert.scrollIntoViewIfNeeded();
    await expect(alert).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-60/assets/settings-recovery-${action}-fixture-390.png`), fullPage: true });
    await page.reload();
    await page.getByTestId('nav-settings').click();
    await page.getByRole('button', { name: 'Agent runtimes', exact: true }).click();
    await expect(filesystem).toBeChecked();
    expect(writes).toBe(1);
  });
}
