import { expect, test } from '@playwright/test';
import type { ChatMessage } from '@kalio/types';
import { resolve } from 'node:path';
import { selectSession } from './helpers/test-config';

test.skip(process.env['KALIO_DEVIN_KALIO_READ_QA105'] !== '1', 'Authorized real SWE-2 Kalio read only');
test('Kalio read still returns project content after native policy enforcement', async ({ page }) => {
  test.setTimeout(120000);
  const sessionId = 'W4fggLSunrJB41C24MV7C';
  const submittedAt = Date.now();
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, sessionId, 'New Chat');
  const input = page.getByRole('textbox', { name: 'Chat message', exact: true });
  await expect(input).toBeVisible({ timeout: 30000 });
  const stop = page.getByRole('button', { name: 'Stop agent', exact: true });
  await expect(stop).toHaveCount(0);
  await expect(page.getByText('Devin CLI · swe-2', { exact: true })).toBeVisible();
  await input.fill('QA105_KALIO_READ: model dokładnie swe-2. Wykonaj dokładnie jeden Kalio fs_read path E:/Projekty/home-site/package.json. ' +
    'Nie używaj natywnych narzędzi, terminala, web, zapisów ani innych plików. Zakończ nagłówkiem ## QA105_KALIO_READ_RESULT i podaj nazwę projektu oraz skrypt build z rzeczywistego wyniku.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  try {
    await expect(page.getByRole('heading', { name: 'QA105_KALIO_READ_RESULT', exact: true })).toBeVisible({ timeout: 90000 });
    await expect(stop).toHaveCount(0);
    const response = await page.request.get(`http://127.0.0.1:3316/api/sessions/${sessionId}/messages`);
    expect(response.ok()).toBe(true);
    const messages = await response.json() as ChatMessage[];
    const prompt = messages.find(m => m.role === 'user' && m.createdAt >= submittedAt && m.content.startsWith('QA105_KALIO_READ:'));
    expect(prompt?.turnId).toBeTruthy();
    const calls = messages.filter(m => m.turnId === prompt!.turnId).flatMap(m => m.toolCalls ?? []);
    expect(calls.map(call => call.name)).toEqual(['fs_read']);
    const results = messages.filter(m => m.turnId === prompt!.turnId && m.role === 'tool_result');
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toContain('react');
    expect(results[0]!.content).toContain('vite');
    const turn = page.getByTestId('agent-turn-bubble').filter({ hasText: 'QA105_KALIO_READ_RESULT' });
    await expect(turn.getByTestId('tool-execution-origin')).toHaveText('Kalio');
    await page.reload();
    await expect(turn).toContainText('QA105_KALIO_READ_RESULT');
    await expect(turn.getByTestId('tool-execution-origin')).toHaveText('Kalio');
    await page.screenshot({ path: resolve(__dirname, '../../../docs/raports/qa-run-105/assets/kalio-read-after-f5.png') });
    console.log(JSON.stringify({ turnId: prompt!.turnId, results: results.length }));
  } finally {
    if (await stop.isVisible()) await stop.click();
  }
});
