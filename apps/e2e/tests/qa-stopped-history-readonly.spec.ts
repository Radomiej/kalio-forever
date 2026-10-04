import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { APP_BASE, selectSession } from './helpers/test-config';

test.skip(process.env['KALIO_QA_STOPPED_HISTORY'] !== '1', 'Read-only fixed-QA evidence only');
test('real stopped Devin response restores its durable interruption label after F5', async ({ page }) => {
  expect(APP_BASE.replace(/\/$/, '')).toBe('http://localhost:5288');
  await page.goto('/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, 'W4fggLSunrJB41C24MV7C', 'Devin stopped history');
  const partial = page.getByTestId('agent-turn-bubble').filter({ hasText: 'QA91_STREAM_BEGIN' }).last();
  await expect(partial.getByTestId('turn-error-indicator')).toContainText('Interrupted');
  await page.reload();
  await expect(partial.getByTestId('turn-error-indicator')).toContainText('Interrupted');
  await expect(page.getByRole('heading', { name: 'QA138_READ_RESULT', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('chat-connection-status')).toHaveCount(0, { timeout: 30_000 });
  await page.screenshot({ path: resolve(__dirname, '../../../docs/raports/qa-run-141/assets/stopped-history-1280.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const hide = page.getByRole('button', { name: 'Hide conversations', exact: true });
  if (await hide.isVisible()) await hide.click();
  await partial.getByTestId('turn-error-indicator').scrollIntoViewIfNeeded();
  await expect(partial.getByTestId('turn-error-indicator')).toBeVisible();
  await page.screenshot({ path: resolve(__dirname, '../../../docs/raports/qa-run-141/assets/stopped-history-390.png') });
});
