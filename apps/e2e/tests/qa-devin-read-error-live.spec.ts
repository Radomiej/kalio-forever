import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import type { AuditLogEntry, ChatMessage } from '@kalio/types';
import { API_BASE, selectSession, sendMessageFromComposer } from './helpers/test-config';

test.skip(process.env['KALIO_DEVIN_READ_ERROR'] !== '1', 'Explicit real Devin error recovery QA');
test('SWE-2 reports a missing project file and continues with a successful read', async ({ page, request }) => {
  test.setTimeout(120_000);
  const run = process.env['KALIO_DEVIN_ERROR_REPORT_RUN'] ?? '181';
  if (!/^[1-9]\d*$/.test(run)) throw new Error('Numeric report run required');
  const session = 'W4fggLSunrJB41C24MV7C';
  const replayMarker = process.env['KALIO_DEVIN_ERROR_REPLAY_MARKER'];
  if (replayMarker && !/^QA[1-9]\d*_ERROR_\d+$/.test(replayMarker)) throw new Error('Invalid replay marker');
  const started = replayMarker ? Number(replayMarker.split('_').at(-1)) : Date.now();
  const marker = replayMarker ?? `QA${run}_ERROR_${started}`;
  const missingPath = `E:/Projekty/home-site/qa-missing-${started}.txt`;
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, session, 'HomeSite read error recovery');
  const stop = page.getByRole('button', { name: 'Stop agent', exact: true });
  await expect(stop).toHaveCount(0);
  await expect(page.getByText('Devin CLI · swe-2', { exact: true })).toBeVisible();
  if (!replayMarker) {
    await sendMessageFromComposer(page, `${marker}: model dokładnie swe-2. Test obsługi błędu: wykonaj jeden Kalio fs_read path ${missingPath}; ten plik celowo nie istnieje. Nie twórz go i nie ponawiaj próby. Następnie wykonaj jeden Kalio fs_read path E:/Projekty/home-site/package.json. Bez innych narzędzi, zapisów, terminala, native tools, web lub commitów. Podaj rzeczywisty błąd pierwszego odczytu i nazwę projektu z drugiego. Zakończ nagłówkiem ## ${marker}_RESULT.`);
  }
  try {
    await expect(page.getByRole('heading', { name: `${marker}_RESULT`, exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(stop).toHaveCount(0);
    const history = await request.get(`${API_BASE}/sessions/${session}/messages`);
    expect(history.ok()).toBe(true);
    const messages = await history.json() as ChatMessage[];
    const prompt = messages.find(message => message.role === 'user' && message.content.startsWith(`${marker}:`));
    expect(prompt?.turnId).toBeTruthy();
    const results = messages.filter(message => message.role === 'tool_result' && message.turnId === prompt!.turnId);
    expect(results).toHaveLength(2);
    expect(JSON.parse(results[0]!.content)).toEqual({
      status: 'error', errorCode: 'TOOL_EXECUTION_FAILED', errorMessage: `NOT_FOUND: ${missingPath}`,
    });
    expect(results[1]!.content).toContain('nexora-home-site');
    const auditResponse = await request.get(`${API_BASE}/audit-log?sessionId=${session}&since=${started}&limit=2000&source=all`);
    expect(auditResponse.ok()).toBe(true);
    const audit = await auditResponse.json() as AuditLogEntry[];
    const callIds = new Set(results.map(message => message.toolCallId));
    const turnAudit = audit.filter(entry => callIds.has(String(entry.data?.['callId'])));
    expect(turnAudit.filter(entry => entry.type === 'tool_call').map(entry => entry.label)).toEqual(['fs_read', 'fs_read']);
    expect(audit.filter(entry => entry.label === 'process.cmd.invocation')).toHaveLength(0);
    const turn = page.getByTestId('agent-turn-bubble').filter({ hasText: `${marker}_RESULT` });
    const failed = turn.getByTestId('tool-call-bubble').filter({ hasText: 'failed' });
    await expect(failed).toHaveCount(1);
    await page.reload();
    await expect(failed).toHaveCount(1);
    await expect(turn.getByTestId('tool-execution-origin')).toHaveText(['Kalio', 'Kalio']);
    await expect(stop).toHaveCount(0);
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${run}/assets/error-recovery-after-f5.png`) });
    console.log(JSON.stringify({ marker, turnId: prompt!.turnId, failedResult: results[0]!.content }));
  } finally {
    if (!replayMarker && await stop.isVisible()) await stop.click();
  }
});
