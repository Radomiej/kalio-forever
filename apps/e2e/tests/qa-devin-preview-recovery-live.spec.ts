import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import type { AuditLogEntry } from '@kalio/types';
import { API_BASE, selectSession, sendMessageFromComposer } from './helpers/test-config';

const reportRun = process.env['KALIO_DEVIN_PREVIEW_REPORT_RUN'] ?? '148';
if (!/^[1-9]\d*$/.test(reportRun)) throw new Error('Numeric report run required');

test.skip(process.env['KALIO_DEVIN_PREVIEW_RECOVERY'] !== '1', 'Explicit approved HomeSite preview recovery only');
test('SWE-2 restores one approved HomeSite preview and persists its response', async ({ page, request }) => {
  test.setTimeout(120_000);
  const session = 'W4fggLSunrJB41C24MV7C';
  const preview = 'http://127.0.0.1:57868/';
  const existing = await request.get(preview, { timeout: 3000 }).catch(() => null);
  expect(existing?.ok(), 'Never launch a duplicate preview').not.toBe(true);
  const started = Date.now();
  const resultHeading = `QA${reportRun}_PREVIEW_RESULT_${started}`;
  const command = { command: 'npm', args: ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '57868', '--strictPort'], cwd: 'E:/Projekty/home-site' };
  const audit = async () => {
    const response = await request.get(`${API_BASE}/audit-log?sessionId=${session}&since=${started}&limit=2000&source=all`);
    expect(response.ok()).toBe(true);
    return await response.json() as AuditLogEntry[];
  };
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, session, 'HomeSite preview recovery');
  await expect(page.getByText('Devin CLI · swe-2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  await sendMessageFromComposer(page, `QA${reportRun}: model dokładnie swe-2. Przywróć podgląd HomeSite wyłącznie jednym Kalio terminal_spawn z dokładnym JSON ${JSON.stringify(command)}. Zaczekaj na zatwierdzenie. Potem terminal_output bez waitMs, preview ma pozostać running. Bez innych i natywnych narzędzi, plików, builda, instalacji, commitów. Zakończ nagłówkiem ## ${resultHeading} i podaj id terminala oraz rzeczywisty status.`);
  const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
  try {
    await expect(confirm).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('tool-call-bubble').filter({ has: confirm }).getByRole('region', { name: 'Full tool arguments' })).toBeVisible();
    const calls = (await audit()).filter(entry => entry.type === 'tool_call');
    expect(calls).toHaveLength(1);
    expect(calls[0].label).toBe('terminal_spawn');
    expect(calls[0].data?.['args']).toEqual(command);
    expect((await audit()).filter(entry => entry.label === 'process.cmd.invocation')).toHaveLength(0);
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/preview-approval.png`) });
    await confirm.click();
    await expect(page.getByRole('heading', { name: resultHeading, exact: true })).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await request.get(preview)).status()).toBe(200);
    const entries = await audit();
    expect(entries.filter(entry => entry.type === 'tool_call' && entry.label === 'terminal_spawn')).toHaveLength(1);
    expect(entries.filter(entry => entry.label === 'process.cmd.invocation')).toHaveLength(1);
    expect(entries.filter(entry => entry.type === 'tool_call').every(entry => ['terminal_spawn', 'terminal_output'].includes(entry.label))).toBe(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: resultHeading, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('chat-connection-status')).toHaveCount(0, { timeout: 30_000 });
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/preview-response-after-f5.png`) });
    await page.goto(preview);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/home-site.png`), fullPage: true });
  } finally {
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
    if (await cancel.isVisible()) await cancel.click();
  }
});
