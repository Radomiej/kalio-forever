import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import type { AuditLogEntry, ChatMessage } from '@kalio/types';
import { API_BASE, selectSession, sendMessageFromComposer } from './helpers/test-config';

test.skip(process.env['KALIO_DEVIN_LIST_TOOLS'] !== '1', 'Explicit approved read-only Devin tool QA');
test('SWE-2 lists the approved project and existing terminals through Kalio', async ({ page, request }) => {
  test.setTimeout(120_000);
  const run = process.env['KALIO_DEVIN_LIST_REPORT_RUN'] ?? '180';
  if (!/^[1-9]\d*$/.test(run)) throw new Error('Numeric report run required');
  const session = 'W4fggLSunrJB41C24MV7C';
  const started = Date.now();
  const marker = `QA${run}_LIST_${started}`;
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, session, 'HomeSite list tools audit');
  const stop = page.getByRole('button', { name: 'Stop agent', exact: true });
  await expect(stop).toHaveCount(0);
  await expect(page.getByText('Devin CLI · swe-2', { exact: true })).toBeVisible();
  await sendMessageFromComposer(page, `${marker}: użyj dokładnie modelu swe-2. Wykonaj dokładnie jeden Kalio fs_list dla E:/Projekty/home-site i dokładnie jeden Kalio terminal_list, żeby odczytać istniejące terminale. Bez innych narzędzi, bez uruchamiania procesów, zapisu, native tools, web lub commitów. Podaj rzeczywiście odczytane nazwy plików oraz liczbę terminali. Zakończ nagłówkiem ## ${marker}_RESULT.`);
  try {
    await expect(page.getByRole('heading', { name: `${marker}_RESULT`, exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(stop).toHaveCount(0);
    const response = await request.get(`${API_BASE}/audit-log?sessionId=${session}&since=${started}&limit=2000&source=all`);
    expect(response.ok()).toBe(true);
    const audit = await response.json() as AuditLogEntry[];
    expect(audit.filter(entry => entry.type === 'tool_call').map(entry => entry.label).sort()).toEqual(['fs_list', 'terminal_list']);
    expect(audit.filter(entry => entry.label === 'process.cmd.invocation')).toHaveLength(0);
    const history = await request.get(`${API_BASE}/sessions/${session}/messages`);
    expect(history.ok()).toBe(true);
    const messages = await history.json() as ChatMessage[];
    const prompt = messages.find(message => message.role === 'user' && message.content.startsWith(`${marker}:`));
    expect(prompt?.turnId).toBeTruthy();
    const results = messages.filter(message => message.role === 'tool_result' && message.turnId === prompt!.turnId);
    expect(results).toHaveLength(2);
    expect(results.some(message => message.content.includes('package.json'))).toBe(true);
    await page.reload();
    const turn = page.getByTestId('agent-turn-bubble').filter({ hasText: `${marker}_RESULT` });
    await expect(turn.getByTestId('tool-execution-origin')).toHaveText(['Kalio', 'Kalio']);
    await expect(stop).toHaveCount(0);
    await page.screenshot({ path: resolve(__dirname, `../../../apps/e2e/outputs/qa-run-${run}/assets/list-tools-after-f5.png`) });
    console.log(JSON.stringify({ marker, turnId: prompt!.turnId, results: results.map(message => ({ callId: message.toolCallId, content: message.content })) }));
  } finally {
    if (await stop.isVisible()) await stop.click();
  }
});
