import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { selectSession } from './helpers/test-config';

const auditUrl = process.env['KALIO_LANDING_AUDIT_URL'];
test.skip(!auditUrl, 'Explicit read-only audit of QA85 UI-created canaries.');

test('landing-created real Codex conversation survives F5 at compact and desktop widths', async ({ page }) => {
  const url = new URL(auditUrl!);
  if (url.protocol !== 'http:' || url.hostname !== 'localhost' || !['5188', '5288'].includes(url.port)) {
    throw new Error('Only the approved fixed DEV or QA environment is supported.');
  }
  const qa = url.port === '5288';
  await page.goto(url.href);
  await page.getByTestId('nav-talk').click();
  await selectSession(page, qa ? '1YzXBrPu4aTEOgUJOH7lt' : 'kwY_D1niMC-ePDn7I72o-', qa ? 'Test QA85 Startu Bez' : 'Test DEV85 Startu Bez');
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await expect(page.getByText('Codex · gpt-5.6-luna', { exact: true })).toBeVisible();
    await expect(page.getByText(qa ? 'QA85_LANDING_OK' : 'DEV85_LANDING_OK', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
    await expect(page.getByText('Kalio is responding.', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(__dirname, `../../../apps/e2e/outputs/qa-run-85/assets/landing-${qa ? 'qa' : 'dev'}-${width}.png`) });
  }
});
