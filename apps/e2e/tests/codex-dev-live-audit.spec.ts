import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { selectSession } from './helpers/test-config';

const auditUrl = process.env['KALIO_CODEX_QA_AUDIT_URL'] ?? process.env['KALIO_CODEX_DEV_AUDIT_URL'];
test.skip(!auditUrl, 'Explicit read-only audit of the existing canary is required.');

test('real Codex response survives reload without stale thinking', async ({ page }) => {
  const url = new URL(auditUrl!);
  if (url.protocol !== 'http:' || url.hostname !== 'localhost' || !['5188', '5288'].includes(url.port)) {
    throw new Error('Only the approved fixed local DEV or QA environment is supported.');
  }
  const qa = url.port === '5288';
  const reportRun = process.env['KALIO_CODEX_AUDIT_REPORT_RUN'] ?? '84';
  if (!/^\d+$/.test(reportRun)) throw new Error('Report run must be numeric.');
  await page.goto(url.href);
  await page.getByTestId('nav-talk').click();
  await selectSession(page, qa ? '58mz05cKrZDGG1DPbMKBU' : 'Kgm0bdtzIt0wpO45h0Xru', qa ? 'Test Komunikacji QA84' : 'Test Komunikacji DEV84');
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await expect(page.getByText('Codex · gpt-5.6-luna', { exact: true })).toBeVisible();
    await expect(page.getByText(qa ? 'QA84_CODEX_OK' : 'DEV84_CODEX_OK', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
    await expect(page.getByText('Kalio is responding.', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/codex-${qa ? 'qa' : 'dev'}-completed-${width}.png`) });
  }
});
