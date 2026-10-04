import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { API_BASE, APP_BASE, selectSession } from './helpers/test-config';

test.skip(process.env['KALIO_GRAPH_GROUP_READONLY'] !== '1', 'Explicit fixed-QA read-only audit');

test('saved Codex build exposes grouped tool details without a new turn', async ({ page, request }) => {
  expect(APP_BASE.replace(/\/$/, '')).toBe('http://localhost:5288');
  expect(API_BASE.replace(/\/$/, '')).toBe('http://127.0.0.1:3316/api');
  const sessionId = 'yvD83rgDA_ZHvUwJKlo_S';
  expect((await request.get(`${API_BASE}/sessions/${sessionId}`)).ok()).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Talk', exact: true }).click();
  await selectSession(page, sessionId, 'codex');
  await page.getByRole('button', { name: 'Graf', exact: true }).click();
  await page.getByText('Tool group', { exact: true }).click();
  const inspector = page.getByRole('complementary');
  await expect(inspector.getByRole('heading', { name: 'Grouped tools' })).toBeVisible();
  await inspector.getByText('terminal_spawn', { exact: true }).click();
  await expect(inspector.getByRole('region', { name: 'terminal_spawn arguments' })).toContainText('E:/Projekty/home-site');
  await expect(inspector.getByRole('region', { name: 'terminal_spawn arguments' })).toContainText('build');
  await expect(inspector.getByRole('region', { name: 'terminal_spawn result' })).toContainText('npm run build');
  await inspector.getByText('terminal_output', { exact: true }).click();
  await expect(inspector.getByRole('region', { name: 'terminal_output result' })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Show raw', exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(__dirname, '../../../docs/raports/qa-run-210/assets/codex-group-details.jpg') });
  await page.reload();
  await expect(page.getByText('Tool group', { exact: true })).toBeVisible();
  await page.getByText('Tool group', { exact: true }).click();
  await inspector.getByText('terminal_spawn', { exact: true }).click();
  await expect(inspector.getByRole('region', { name: 'terminal_spawn arguments' })).toContainText('E:/Projekty/home-site');
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
});
