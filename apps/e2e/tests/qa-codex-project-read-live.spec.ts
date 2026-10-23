import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import type { AuditLogEntry, ChatMessage } from '@kalio/types';
import { API_BASE, selectSession, sendMessageFromComposer } from './helpers/test-config';

test.skip(process.env['KALIO_CODEX_PROJECT_READ'] !== '1', 'Explicit approved ChatGPT project read');
test('ChatGPT Codex reads HomeSite through Kalio and retains tool provenance after F5', async ({ page, request }) => {
  test.setTimeout(120_000);
  const session = 'yvD83rgDA_ZHvUwJKlo_S';
  const run = process.env['KALIO_CODEX_PROJECT_READ_RUN'] ?? '187';
  if (!/^[1-9]\d*$/.test(run)) throw new Error('Numeric report run required');
  const started = Date.now();
  const marker = `QA${run}_CODEX_READ_${started}`;
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, session, 'ChatGPT approved HomeSite read');
  const stop = page.getByRole('button', { name: 'Stop agent', exact: true });
  await expect(stop).toHaveCount(0);
  await sendMessageFromComposer(page, `${marker}: Test ChatGPT/Codex gpt-6-luna. Wykonaj dokładnie jeden Kalio fs_read path E:/Projekty/home-site/package.json. Nie używaj native tools, web, terminala, zapisów ani innych plików. Podaj nazwę projektu i skrypt build z rzeczywistego odczytu. Zakończ nagłówkiem ## ${marker}_RESULT.`);
  try {
    await expect(page.getByRole('heading', { name: `${marker}_RESULT`, exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(stop).toHaveCount(0);
    const response = await request.get(`${API_BASE}/sessions/${session}/messages`);
    expect(response.ok()).toBe(true);
    const messages = await response.json() as ChatMessage[];
    const prompt = messages.find(message => message.role === 'user' && message.content.startsWith(`${marker}:`));
    expect(prompt?.turnId).toBeTruthy();
    const turnMessages = messages.filter(message => message.turnId === prompt!.turnId);
    expect(turnMessages.flatMap(message => message.toolCalls ?? []).map(call => call.name)).toEqual(['fs_read']);
    const results = turnMessages.filter(message => message.role === 'tool_result');
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toContain('nexora-home-site');
    expect(results[0]!.content).toContain('vite build');
    const auditResponse = await request.get(`${API_BASE}/audit-log?sessionId=${session}&since=${started}&limit=2000&source=all`);
    expect(auditResponse.ok()).toBe(true);
    const audit = await auditResponse.json() as AuditLogEntry[];
    expect(audit.filter(entry => entry.type === 'tool_call').map(entry => entry.label)).toEqual(['fs_read']);
    expect(audit.filter(entry => entry.label === 'process.cmd.invocation')).toHaveLength(0);
    await page.reload();
    const turn = page.getByTestId('agent-turn-bubble').filter({ hasText: `${marker}_RESULT` });
    await expect(turn.getByTestId('tool-execution-origin')).toHaveText('Kalio');
    await expect(stop).toHaveCount(0);
    await page.screenshot({ path: resolve(__dirname, `../../../apps/e2e/outputs/qa-run-${run}/assets/codex-project-read-after-f5.png`) });
    console.log(JSON.stringify({ marker, turnId: prompt!.turnId }));
  } finally {
    if (await stop.isVisible()) await stop.click();
  }
});
