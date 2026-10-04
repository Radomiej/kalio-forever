import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import type { ChatMessage } from '@kalio/types';
import { API_BASE, selectSession } from './helpers/test-config';

const reportRun = process.env['KALIO_EMPTY_FAILED_HISTORY_REPORT_RUN'] ?? '162';
if (!/^[1-9]\d*$/.test(reportRun)) throw new Error('Numeric report run required');

test.skip(process.env['KALIO_EMPTY_FAILED_HISTORY_AUDIT'] !== '1', 'Read-only fixed QA155 historical failure audit');
test('the real user-only interrupted Devin turn has an error bubble after F5', async ({ page, request }) => {
  const session = 'W4fggLSunrJB41C24MV7C';
  const turn = '2KjSTYt3_JEoRRsbNVD9D';
  const messages = await (await request.get(`${API_BASE}/sessions/${session}/messages`)).json() as ChatMessage[];
  const prompt = messages.find(message => message.id === 'YNXYWz8UJdEP7yh3upgIl');
  expect(prompt).toMatchObject({ role: 'user', turnId: turn });
  expect(messages.filter(message => message.role === 'assistant' && message.turnId === turn)).toHaveLength(0);
  const runs = await (await request.get(`${API_BASE}/sessions/${session}/runs/history?turnIds=${turn}`)).json() as { status: string }[];
  expect(runs).toHaveLength(1);
  expect(runs[0].status).toBe('interrupted');
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, session, 'Devin user-only failed history');
  await page.reload();
  const user = page.getByTestId('message-bubble').filter({ hasText: 'QA155_RESET_1791087043834' });
  await expect(user).toHaveCount(1);
  const nextBubble = user.locator('xpath=following-sibling::*[1]');
  await expect(nextBubble).toHaveAttribute('data-testid', 'agent-turn-bubble');
  await expect(nextBubble.getByTestId('turn-error-indicator')).toHaveText('⚠Interrupted');
  await expect(nextBubble.getByTestId('turn-loading-indicator')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  await nextBubble.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/user-only-error-after-f5.png`) });
});
