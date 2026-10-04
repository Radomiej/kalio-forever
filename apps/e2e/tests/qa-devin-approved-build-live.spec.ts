import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import type { AuditLogEntry, ChatMessage } from '@kalio/types';
import { API_BASE, APP_BASE, selectSession, sendMessageFromComposer } from './helpers/test-config';

test.skip(process.env['KALIO_DEVIN_APPROVED_BUILD'] !== '1', 'Explicit HomeSite build approval required');
test('SWE-2 builds HomeSite once through manually confirmed Kalio terminal', async ({ page, request }) => {
  test.setTimeout(process.env['KALIO_DEVIN_BUILD_LONG_APPROVAL'] === '1' ? 210_000 : 120_000);
  expect(APP_BASE.replace(/\/$/, '')).toBe('http://localhost:5288');
  const session = 'W4fggLSunrJB41C24MV7C';
  const started = Date.now();
  const reportRun = process.env['KALIO_DEVIN_BUILD_REPORT_RUN'] ?? '144';
  if (!/^[1-9]\d*$/.test(reportRun)) throw new Error('Numeric report run required');
  const marker = `QA${reportRun}_BUILD_${started}`;
  const heading = `${marker}_RESULT`;
  const audit = async () => {
    const response = await request.get(`${API_BASE}/audit-log?sessionId=${session}&since=${started}&limit=2000&source=all`);
    expect(response.ok()).toBe(true);
    return await response.json() as AuditLogEntry[];
  };
  await page.goto('/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, session, 'Approved SWE-2 build');
  await sendMessageFromComposer(page, `${marker}: model dokładnie swe-2. Wykonaj dokładnie jeden Kalio terminal_spawn command npm, args ["run","build"], cwd E:/Projekty/home-site. Zaczekaj na ręczne potwierdzenie. Potem terminal_output z waitMs 30000 i rzeczywisty końcowy exit code. Bez natywnych narzędzi, web, innych komend, instalacji i zmian źródeł. Zakończ nagłówkiem ## ${heading}.`);
  const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
  try {
    await expect(confirm).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('tool-call-bubble').filter({ has: confirm }).getByRole('region', { name: 'Full tool arguments' })).toBeVisible();
    const calls = (await audit()).filter(entry => entry.type === 'tool_call');
    expect(calls).toHaveLength(1);
    expect(calls[0].label).toBe('terminal_spawn');
    expect(calls[0].data?.['args']).toEqual({ command: 'npm', args: ['run', 'build'], cwd: 'E:/Projekty/home-site' });
    expect((await audit()).filter(entry => entry.label === 'process.cmd.invocation')).toHaveLength(0);
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/build-awaiting-confirmation.png`) });
    if (process.env['KALIO_DEVIN_BUILD_PENDING_RELOAD'] === '1') {
      await page.reload();
      await expect(confirm).toBeVisible({ timeout: 30_000 });
      await expect(confirm).toHaveCount(1);
      await expect(page.getByTestId('tool-call-bubble').filter({ has: confirm }).getByRole('region', { name: 'Full tool arguments' })).toBeVisible();
      const reloaded = await audit();
      expect(reloaded.filter(entry => entry.type === 'tool_call')).toEqual(calls);
      expect(reloaded.filter(entry => entry.label === 'process.cmd.invocation')).toHaveLength(0);
      await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/build-pending-after-f5.png`) });
    }
    if (process.env['KALIO_DEVIN_BUILD_LONG_APPROVAL'] === '1') {
      const waitingSince = Date.now();
      // Diagnostic boundary probe only, not a runtime stabilization mechanism.
      for (let stage = 0; stage < 2; stage++) {
        await page.waitForTimeout(35_000);
        await expect(confirm).toBeVisible();
        await expect(confirm).toHaveCount(1);
        const waiting = await audit();
        expect(waiting.filter(entry => entry.type === 'tool_call')).toEqual(calls);
        expect(waiting.filter(entry => entry.label === 'process.cmd.invocation')).toHaveLength(0);
      }
      expect(Date.now() - waitingSince).toBeGreaterThanOrEqual(70_000);
      await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/build-pending-over-70s.png`) });
    }
    await confirm.click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await request.get(`${API_BASE}/sessions/${session}/runs/current`)).text()).toBe('');
    const entries = await audit();
    expect(entries.filter(entry => entry.type === 'tool_call' && entry.label === 'terminal_spawn')).toHaveLength(1);
    expect(entries.filter(entry => entry.label === 'process.cmd.invocation')).toHaveLength(1);
    expect(entries.filter(entry => entry.type === 'tool_call').every(entry => ['terminal_spawn', 'terminal_output'].includes(entry.label))).toBe(true);
    const historyResponse = await request.get(`${API_BASE}/sessions/${session}/messages`);
    expect(historyResponse.ok()).toBe(true);
    const messages = await historyResponse.json() as ChatMessage[];
    const prompt = messages.find(message => message.role === 'user' && message.content.startsWith(`${marker}:`));
    expect(prompt?.turnId).toBeTruthy();
    const results = messages.filter(message => message.turnId === prompt!.turnId && message.role === 'tool_result');
    expect(results.some(message => /"exitCode"\s*:\s*0/.test(message.content))).toBe(true);
    expect(results.some(message => message.content.includes('vite') && message.content.includes('built in'))).toBe(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByTestId('chat-connection-status')).toHaveCount(0, { timeout: 30_000 });
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/build-result-after-f5.png`) });
  } finally {
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
    if (await cancel.isVisible()) await cancel.click();
    const stop = page.getByRole('button', { name: 'Stop agent', exact: true });
    if (await stop.isVisible()) await stop.click();
  }
});
