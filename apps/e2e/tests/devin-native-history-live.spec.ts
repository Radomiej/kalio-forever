import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { selectSession } from './helpers/test-config';

test.skip(process.env['KALIO_DEVIN_NATIVE_HISTORY_QA104'] !== '1', 'Read-only existing native failure only');
test('actual native failure without permission callback remains visible after F5', async ({ page }) => {
  const turnId = process.env['KALIO_DEVIN_NATIVE_HISTORY_TURN_ID'] ?? '8SBdgVD9befum7dY3dpcS';
  const callId = process.env['KALIO_DEVIN_NATIVE_HISTORY_CALL_ID'] ?? 'a7c3048d-776d-4505-a061-8f6925096d1b';
  const callName = process.env['KALIO_DEVIN_NATIVE_HISTORY_CALL_NAME'] ?? 'Read file';
  const reportRun = process.env['KALIO_DEVIN_NATIVE_HISTORY_REPORT_RUN'] ?? '104';
  if (!/^\d+$/.test(reportRun)) throw new Error('Numeric report run required');
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, 'W4fggLSunrJB41C24MV7C', 'New Chat');
  await expect(page.getByRole('textbox', { name: 'Chat message', exact: true })).toBeVisible({ timeout: 30000 });
  console.log((await page.locator('body').ariaSnapshot()).slice(-2500));
  const open = async () => {
    const response = page.waitForResponse(r => r.url().includes('/api/audit-log?')
      && new URL(r.url()).searchParams.get('turnId') === turnId);
    await page.getByRole('button', { name: 'Devin native tool audit', exact: true }).last().click();
    expect((await response).ok()).toBe(true);
    const panel = page.getByTestId('native-tool-audit-panel').last();
    await expect(panel).toContainText(callName);
    await expect(panel).toContainText('Native Devin · failed');
    await expect(panel).toContainText(callId);
    await expect(panel).not.toContainText('blocked by policy');
  };
  await open();
  await page.screenshot({ path: resolve(__dirname, `../../../apps/e2e/outputs/qa-run-${reportRun}/assets/native-failure-visible.png`) });
  await page.reload();
  await open();
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  await page.screenshot({ path: resolve(__dirname, `../../../apps/e2e/outputs/qa-run-${reportRun}/assets/native-failure-after-f5.png`) });
});
