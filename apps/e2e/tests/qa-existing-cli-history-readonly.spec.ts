import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { API_BASE, APP_BASE, selectSession } from './helpers/test-config';

// Opt-in: reads existing approved QA conversations, never creates a turn or fixture.
test.skip(process.env['KALIO_QA_READONLY_HISTORY'] !== '1', 'Manual fixed-QA evidence only');

const conversations = [
  { agent: 'devin', id: 'W4fggLSunrJB41C24MV7C', result: 'QA125_KALIO_READ_RESULT' },
  { agent: 'codex', id: 'yvD83rgDA_ZHvUwJKlo_S', result: 'QA134_CANCEL_RESULT' },
];

for (const conversation of conversations) {
  test(`${conversation.agent} saved result survives F5 without a live turn`, async ({ page, request }) => {
    expect(APP_BASE.replace(/\/$/, '')).toBe('http://localhost:5288');
    expect(API_BASE.replace(/\/$/, '')).toBe('http://127.0.0.1:3316/api');
    await page.setViewportSize({ width: 1440, height: 1000 });
    const response = await request.get(`${API_BASE}/sessions/${conversation.id}`);
    expect(response.ok()).toBeTruthy();
    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, conversation.id, conversation.agent);
    await expect(page.getByText(conversation.result, { exact: true })).toHaveCount(1);
    await page.reload();
    await expect(page.getByText(conversation.result, { exact: true })).toHaveCount(1);
    await expect(page.getByTestId('chat-connection-status')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
    await page.getByText(conversation.result, { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-135/assets/${conversation.agent}-history-1440.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    const hide = page.getByRole('button', { name: 'Hide conversations', exact: true });
    if (await hide.isVisible()) await hide.click();
    await expect(page.getByTestId('chat-connection-status')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText(conversation.result, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-135/assets/${conversation.agent}-history-390.png`) });
  });
}
