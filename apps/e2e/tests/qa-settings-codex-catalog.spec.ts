import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { API_BASE, APP_BASE } from './helpers/test-config';

test.skip(process.env['KALIO_QA223_CATALOG'] !== '1', 'Explicit fixed-QA catalog refresh');

test('Settings Codex Recheck refreshes catalog without changing host epoch', async ({ page, request }) => {
  expect(APP_BASE.replace(/\/$/, '')).toBe('http://localhost:5288');
  expect(API_BASE.replace(/\/$/, '')).toBe('http://127.0.0.1:3316/api');
  const endpoint = `${API_BASE}/runtime/native-cli-integrations/chatgpt-default/models`;
  const beforeResponse = await request.get(endpoint);
  expect(beforeResponse.ok()).toBe(true);
  const before = await beforeResponse.json() as { checkedAt: number; processEpoch: string };
  const started = Date.now();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Agent runtimes', exact: true }).click();
  await page.getByText('Codex', { exact: true }).click();
  const card = page.getByRole('article').filter({ has: page.getByRole('button', { name: 'Reset', exact: true }) });
  await card.getByRole('button', { name: 'Recheck', exact: true }).click();
  await expect.poll(async () => {
    const response = await request.get(endpoint);
    expect(response.ok()).toBe(true);
    const body = await response.text();
    if (!body) return 0; // Cache is unavailable while explicit discovery is running.
    const catalog = JSON.parse(body) as { checkedAt: number; processEpoch: string; models: string[] };
    expect(catalog.processEpoch).toBe(before.processEpoch);
    expect(catalog.models).toContain('gpt-6-luna');
    return catalog.checkedAt;
  }).toBeGreaterThan(Math.max(before.checkedAt, started));
  await expect(card.getByRole('button', { name: 'Recheck', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: resolve(__dirname, '../../../apps/e2e/outputs/qa-run-223/assets/settings-codex-recheck.png') });
});
