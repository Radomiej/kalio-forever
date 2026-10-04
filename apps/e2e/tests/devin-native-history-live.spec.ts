import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { selectSession } from './helpers/test-config';

test.skip(process.env['KALIO_DEVIN_NATIVE_HISTORY_QA104'] !== '1', 'Read-only existing native failure only');
test('actual native failure without permission callback remains visible after F5', async ({ page }) => {
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, 'W4fggLSunrJB41C24MV7C', 'New Chat');
  await expect(page.getByRole('textbox', { name: 'Chat message', exact: true })).toBeVisible({ timeout: 30000 });
  console.log((await page.locator('body').ariaSnapshot()).slice(-2500));
  const open = async () => {
    const response = page.waitForResponse(r => r.url().includes('/api/audit-log?')
      && new URL(r.url()).searchParams.get('turnId') === '8SBdgVD9befum7dY3dpcS');
    await page.getByRole('button', { name: 'Native tool audit', exact: true }).last().click();
    expect((await response).ok()).toBe(true);
    const panel = page.getByTestId('native-tool-audit-panel').last();
    await expect(panel).toContainText('Read file');
    await expect(panel).toContainText('Native Devin · failed');
    await expect(panel).toContainText('a7c3048d-776d-4505-a061-8f6925096d1b');
    await expect(panel).not.toContainText('blocked by policy');
  };
  await open();
  await page.screenshot({ path: resolve(__dirname, '../../../docs/raports/qa-run-104/assets/native-failure-visible.png') });
  await page.reload();
  await open();
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  await page.screenshot({ path: resolve(__dirname, '../../../docs/raports/qa-run-104/assets/native-failure-after-f5.png') });
});
