import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { selectSession } from './helpers/test-config';

const qa = process.env['KALIO_FIXED_QA_READONLY_AUDIT_URL'];
test.skip(!qa, 'Explicit read-only audit of the existing fixed QA is required.');

test('completed real Home Site conversation hydrates without stale thinking on mobile and tablet', async ({ page }) => {
  const url = new URL(qa!);
  if (url.protocol !== 'http:' || url.hostname !== 'localhost' || url.port !== '5288') {
    throw new Error('Only the explicitly approved fixed local QA is supported');
  }
  await page.goto(url.href);
  await page.getByTestId('nav-talk').click();
  await selectSession(page, 'W4fggLSunrJB41C24MV7C', 'New Chat');
  for (const width of [320, 390, 820]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await expect(page.getByText('Devin CLI · swe-2', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Chat message' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
    await expect(page.getByText('Kalio is responding.', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('session-panel')).not.toBeVisible();
    const thinking = page.getByRole('button', { name: 'Thinking', exact: true });
    expect(await thinking.locator('.animate-pulse, .loading').count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-67/assets/completed-real-chat-${width}.png`) });
  }
});
