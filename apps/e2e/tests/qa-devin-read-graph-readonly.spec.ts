import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { API_BASE, APP_BASE, selectSession } from './helpers/test-config';

test.skip(process.env['KALIO_DEVIN_READ_GRAPH'] !== '1', 'Approved fixed-QA read-only audit');
test('saved real Devin read agrees between chat and grouped graph after F5', async ({ page, request }) => {
  expect(APP_BASE.replace(/\/$/, '')).toBe('http://localhost:5288');
  expect(API_BASE.replace(/\/$/, '')).toBe('http://127.0.0.1:3316/api');
  const session = 'W4fggLSunrJB41C24MV7C';
  const callId = 'mcp-0a5fe414-5f14-4d2f-9181-8dbe33ee7d7b-5';
  const report = process.env['KALIO_READ_GRAPH_REPORT_RUN'];
  if (!report || !/^[1-9]\d*$/.test(report)) throw new Error('New numeric report run required');
  const beforeResponse = await request.get(`${API_BASE}/sessions/${session}/messages`);
  expect(beforeResponse.ok()).toBeTruthy();
  const before = await beforeResponse.json() as unknown;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, session, 'Devin read');
  const bubble = page.getByTestId('agent-turn-bubble').filter({
    has: page.getByRole('heading', { name: 'QA268_READ_RESULT', exact: true }),
  });
  await expect(bubble).toHaveCount(1);
  await expect(bubble).toContainText('nexora-home-site');
  await expect(bubble.getByTestId('tool-execution-origin')).toHaveCount(1);
  await expect(bubble).toContainText('fs_read');
  await page.getByRole('button', { name: 'Graf', exact: true }).click();
  for (let reload = 0; reload < 2; reload++) {
    const group = page.getByTestId(`graph-node-tool:${callId}`);
    await expect(group).toHaveCount(1);
    await group.click();
    const inspector = page.getByRole('complementary');
    await expect(inspector.getByRole('heading', { name: 'Tool details', exact: true })).toBeVisible();
    await inspector.getByRole('button', { name: 'Show raw', exact: true }).click();
    await expect(inspector).toContainText('E:/Projekty/home-site/package.json');
    await expect(inspector).toContainText('nexora-home-site');
    if (reload === 0) await page.reload();
  }
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  await page.screenshot({ path: resolve(__dirname, `../../../apps/e2e/outputs/qa-run-${report}/assets/devin-read-graph-after-f5.png`) });
  const afterResponse = await request.get(`${API_BASE}/sessions/${session}/messages`);
  expect(afterResponse.ok()).toBeTruthy();
  expect(await afterResponse.json()).toEqual(before);
});
