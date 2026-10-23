import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { API_BASE, APP_BASE, selectSession } from './helpers/test-config';

test.skip(process.env['KALIO_QA217_READONLY'] !== '1', 'Explicit fixed-QA persisted result audit');

test('QA217 real Devin read persists as one completed response after reload', async ({ page }) => {
  expect(APP_BASE.replace(/\/$/, '')).toBe('http://localhost:5288');
  expect(API_BASE.replace(/\/$/, '')).toBe('http://127.0.0.1:3316/api');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Talk', exact: true }).click();
  await selectSession(page, 'W4fggLSunrJB41C24MV7C', 'Devin QA217');
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.reload();
  const bubble = page.getByTestId('agent-turn-bubble').filter({
    has: page.getByRole('heading', { name: 'QA217_READ_RESULT', exact: true }),
  });
  await expect(bubble).toHaveCount(1);
  await expect(bubble).toContainText('nexora-home-site');
  await expect(bubble).toContainText('vite build');
  await expect(bubble.getByTestId('tool-execution-origin')).toHaveCount(1);
  await expect(bubble).toContainText('fs_read');
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  await bubble.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(__dirname, '../../../apps/e2e/outputs/qa-run-217/assets/devin-read-after-f5.jpg') });
});
