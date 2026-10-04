import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import type { AuditLogEntry, ChatMessage } from '@kalio/types';
import { API_BASE, selectSession, sendMessageFromComposer } from './helpers/test-config';

test.skip(process.env['KALIO_DEVIN_APPROVED_WRITE'] !== '1', 'Approved HomeSite documentation write only');
test('SWE-2 writes one confirmed HomeSite handoff and reads the actual content', async ({ page, request }) => {
  test.setTimeout(120_000);
  const session = 'W4fggLSunrJB41C24MV7C';
  const started = Date.now();
  const reportRun = process.env['KALIO_DEVIN_WRITE_REPORT_RUN'] ?? '179';
  if (!/^[1-9]\d*$/.test(reportRun)) throw new Error('Numeric report run required');
  const marker = `QA${reportRun}_WRITE_${started}`;
  const path = `E:/Projekty/home-site/docs/kalio-qa-handoff-${started}.md`;
  const content = `# HomeSite QA handoff\n\nReact/Vite fictional company demo.\nThe contact form is a demo and sends no email.\nBuild: npm run build.\nVerified write/read marker: ${marker}\n`;
  const audit = async () => {
    const response = await request.get(`${API_BASE}/audit-log?sessionId=${session}&since=${started}&limit=2000&source=all`);
    expect(response.ok()).toBe(true);
    return await response.json() as AuditLogEntry[];
  };
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, session, 'HomeSite confirmed documentation write');
  const stop = page.getByRole('button', { name: 'Stop agent', exact: true });
  await expect(stop).toHaveCount(0);
  await expect(page.getByText('Devin CLI · swe-2', { exact: true })).toBeVisible();
  await sendMessageFromComposer(page, `${marker}: model dokładnie swe-2. Utwórz nowy plik dokumentacji wyłącznie jednym Kalio fs_write z dokładnym JSON ${JSON.stringify({ path, content })}. Poczekaj na zatwierdzenie. Potem dokładnie jeden Kalio fs_read tej samej ścieżki i sprawdź rzeczywistą treść. Bez innych/natywnych narzędzi, terminala, web, zmian kodu lub commitów. Zakończ nagłówkiem ## ${marker}_RESULT i podaj odczytany marker.`);
  const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
  try {
    await expect(confirm).toBeVisible({ timeout: 60_000 });
    const pending = page.getByTestId('tool-call-bubble').filter({ has: confirm });
    await expect(pending.getByRole('region', { name: 'Full tool arguments' })).toBeVisible();
    const before = await audit();
    const calls = before.filter(entry => entry.type === 'tool_call');
    expect(calls).toHaveLength(1);
    expect(calls[0].label).toBe('fs_write');
    expect(calls[0].data?.['args']).toEqual({ path, content });
    expect(before.filter(entry => entry.label === 'process.cmd.invocation')).toHaveLength(0);
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/write-awaiting-confirmation.png`) });
    await confirm.click();
    await expect(page.getByRole('heading', { name: `${marker}_RESULT`, exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(stop).toHaveCount(0);
    const after = await audit();
    expect(after.filter(entry => entry.type === 'tool_call').map(entry => entry.label)).toEqual(['fs_write', 'fs_read']);
    expect(after.filter(entry => entry.label === 'process.cmd.invocation')).toHaveLength(0);
    const response = await request.get(`${API_BASE}/sessions/${session}/messages`);
    expect(response.ok()).toBe(true);
    const messages = await response.json() as ChatMessage[];
    const prompt = messages.find(message => message.role === 'user' && message.content.startsWith(`${marker}:`));
    expect(prompt?.turnId).toBeTruthy();
    const results = messages.filter(message => message.role === 'tool_result' && message.turnId === prompt!.turnId);
    expect(results).toHaveLength(2);
    expect(results.some(message => message.content.includes('bytesWritten'))).toBe(true);
    expect(results.some(message => JSON.parse(message.content).content === content)).toBe(true);
    await page.reload();
    const turn = page.getByTestId('agent-turn-bubble').filter({ hasText: `${marker}_RESULT` });
    await expect(turn.getByTestId('tool-execution-origin')).toHaveCount(2);
    await expect(turn.getByTestId('tool-execution-origin')).toHaveText(['Kalio', 'Kalio']);
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/write-read-after-f5.png`) });
    console.log(JSON.stringify({ path, turnId: prompt!.turnId }));
  } finally {
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
    if (await cancel.isVisible()) await cancel.click();
    if (await stop.isVisible()) await stop.click();
  }
});
