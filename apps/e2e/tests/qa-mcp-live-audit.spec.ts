import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const qa = process.env['KALIO_FIXED_QA_READONLY_AUDIT_URL'];
const reportRun = process.env['KALIO_FIXED_QA_REPORT_RUN'] ?? '70';
test.skip(!qa, 'Explicit read-only fixed QA audit is required.');

test('actual fixed QA exposes connected Playwright and does not hide unavailable Data Analyst', async ({ page }) => {
  const url = new URL(qa!);
  if (url.protocol !== 'http:' || url.hostname !== 'localhost' || url.port !== '5288'
    || !/^[1-9]\d*$/.test(reportRun)) throw new Error('Only approved fixed QA and numeric report run are supported');
  await page.goto(url.href);
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('button', { name: 'MCP', exact: true }).click();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('button', { name: /^playwright-orchestrator\s+26$/ })).toBeVisible();
    await expect(page.getByText('http://127.0.0.1:3333/mcp', { exact: true })).toBeVisible();
    await expect(page.getByText('http://127.0.0.1:3000/mcp', { exact: true })).toBeVisible();
    await expect(page.getByText('fetch failed', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(__dirname, `../../../apps/e2e/outputs/qa-run-${reportRun}/assets/actual-mcp-${width}.png`) });
  }
});
