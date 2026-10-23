import { expect, test } from '@playwright/test';
import type { AuditLogEntry, ChatMessage } from '@kalio/types';
import { resolve } from 'node:path';
import { selectSession } from './helpers/test-config';

test.skip(process.env['KALIO_DEVIN_QUEUE_QA97'] !== '1', 'Authorized real Devin queue test only');
test('queued Devin prompt drains once after the active turn and survives reload', async ({ page }) => {
  test.setTimeout(180000);
  const session = 'W4fggLSunrJB41C24MV7C';
  const api = 'http://127.0.0.1:3316/api';
  const reportRun = process.env['KALIO_DEVIN_QUEUE_REPORT_RUN'] ?? '97';
  if (!/^\d+$/.test(reportRun)) throw new Error('Report run must be numeric');
  const shot = (name: string) => resolve(__dirname, `../../../apps/e2e/outputs/qa-run-${reportRun}/assets/${name}.png`);
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, session, 'New Chat');
  await expect(page.getByRole('textbox', { name: 'Chat message', exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Devin CLI · swe-2', { exact: true })).toBeVisible();
  const stop = page.getByRole('button', { name: 'Stop agent', exact: true });
  await expect(stop).toHaveCount(0);
  console.log((await page.locator('body').ariaSnapshot()).slice(-1200));
  const input = page.getByRole('textbox', { name: 'Chat message', exact: true });
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  await input.fill('QA97_FIRST: model dokładnie swe-2. Bez narzędzi, plików i terminala. Zacznij akapitem QA97_FIRST_BEGIN, następnie 30 numerowanych wskazówek dla strony firmy IT, po dwa zdania. Zakończ nagłówkiem ## QA97_FIRST_DONE. To test kolejki, nie wykonuj żadnych innych działań.');
  await send.click();
  try {
    await expect(page.getByTestId('agent-turn-bubble').last()).toContainText('QA97_FIRST_BEGIN', { timeout: 90000 });
    await expect(stop).toBeVisible();
    await input.fill('QA97_SECOND: model dokładnie swe-2. To osobna wiadomość w kolejce, nie kontynuuj poprzedniej listy. Bez narzędzi, odczytów, terminala i zmian. Odpowiedz tylko nagłówkiem ## QA97_SECOND_DONE oraz słowem GOTOWE.');
    await send.click();
    await expect(page.getByTestId('chat-queued-badge')).toContainText('Queued (1)');
    await page.screenshot({ path: shot('queued-during-generation') });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'QA97_SECOND_DONE', exact: true })).toBeVisible({ timeout: 120000 });
    await expect(stop).toHaveCount(0, { timeout: 30000 });
    await expect(page.getByTestId('chat-queued-badge')).toHaveCount(0);
    await expect(page.getByText('Kalio is responding.', { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'QA97_FIRST_DONE', exact: true })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'QA97_SECOND_DONE', exact: true })).toHaveCount(1);
    await page.screenshot({ path: shot('both-completed-after-f5') });
    const historyResponse = await page.request.get(`${api}/sessions/${session}/messages`);
    expect(historyResponse.ok()).toBe(true);
    const messages = await historyResponse.json() as ChatMessage[];
    const prompts = messages.filter(m => m.role === 'user' && /^QA97_(FIRST|SECOND):/.test(m.content));
    expect(prompts).toHaveLength(2);
    const auditResponse = await page.request.get(`${api}/audit-log?sessionId=${session}&since=${prompts[0]!.createdAt}&limit=2000&source=all`);
    expect(auditResponse.ok()).toBe(true);
    const audit = await auditResponse.json() as AuditLogEntry[];
    expect(audit.length).toBeLessThan(2000);
    for (const prompt of prompts) {
      expect(audit.filter(e => e.label === 'llm.turn.started' && e.data?.['turnId'] === prompt.turnId)).toHaveLength(1);
      expect(audit.filter(e => e.label === 'llm.turn.completed' && e.data?.['turnId'] === prompt.turnId)).toHaveLength(1);
    }
    expect(audit.filter(e => e.label === 'process.cmd.invocation')).toHaveLength(0);
    console.log(JSON.stringify({ turns: prompts.map(m => m.turnId), since: prompts[0]!.createdAt, auditRows: audit.length }));
  } finally {
    if (await stop.isVisible()) await stop.click();
  }
});
