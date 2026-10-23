import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import type { AuditLogEntry } from '@kalio/types';
import { API_BASE, selectSession, sendMessageFromComposer } from './helpers/test-config';

const codex = process.env['KALIO_CODEX_DENIED_COMMAND'] === '1';
const devin = process.env['KALIO_DEVIN_DENIED_COMMAND'] === '1';
if (codex && devin) throw new Error('Choose exactly one CLI provider for this live denial test');
const run = process.env['KALIO_DENIED_COMMAND_REPORT_RUN'] ?? (codex ? '150' : '149');
if (!/^[1-9]\d*$/.test(run)) throw new Error('Numeric QA report run required');
test.skip(!codex && !devin, 'Explicit authorized real command-denial test');
test('CLI agent respects a denied Kalio command and continues without host reset', async ({ page, request }) => {
  test.setTimeout(120_000);
  const session = codex ? 'yvD83rgDA_ZHvUwJKlo_S' : 'W4fggLSunrJB41C24MV7C';
  const started = Date.now();
  const hosts = async () => {
    const response = await request.get(`${API_BASE}${codex ? '/runtime/native-cli-integrations' : '/runtime/devin-cli/status'}`);
    expect(response.ok()).toBe(true);
    if (!codex) return (await response.json()).hosts as { processEpoch: string }[];
    const integrations = await response.json() as { provider: string; authProfileId: string; processEpoch: string }[];
    return integrations.filter(item => item.provider === 'codex' && item.authProfileId === 'chatgpt-default');
  };
  const before = await hosts();
  expect(before).toHaveLength(1);
  const epoch = before[0].processEpoch;
  expect(typeof epoch).toBe('string');
  const audit = async () => {
    const response = await request.get(`${API_BASE}/audit-log?sessionId=${session}&since=${started}&limit=2000&source=all`);
    expect(response.ok()).toBe(true);
    return await response.json() as AuditLogEntry[];
  };
  const marker = `QA${run}_DENIED_${started}`;
  const followup = `QA${run}_FOLLOWUP_${started}`;
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, session, 'Denied command recovery');
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  await sendMessageFromComposer(page, `QA${run} test odmowy, model dokładnie ${codex ? 'gpt-6-luna' : 'swe-2'}. Wywołaj dokładnie raz Kalio terminal_spawn command npm, args ["run","build"], cwd E:/Projekty/home-site, i zaczekaj na ręczne zatwierdzenie. Gdy dostaniesz odmowę, nie ponawiaj i nie używaj żadnych innych/natywnych narzędzi. Zakończ nagłówkiem ## ${marker} i napisz, że komenda nie została wykonana. Nie zmieniaj plików, ustawień ani providerów.`);
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  try {
    await expect(cancel).toBeVisible({ timeout: 60_000 });
    const confirmation = page.getByTestId('tool-call-bubble').filter({ has: cancel });
    await expect(confirmation).toHaveCount(1);
    await expect(confirmation.getByRole('region', { name: 'Full tool arguments' })).toBeVisible();
    const calls = (await audit()).filter(entry => entry.type === 'tool_call');
    expect(calls).toHaveLength(1);
    expect(calls[0].label).toBe('terminal_spawn');
    expect(calls[0].data?.['args']).toEqual({ command: 'npm', args: ['run', 'build'], cwd: 'E:/Projekty/home-site' });
    expect((await audit()).filter(entry => entry.label === 'process.cmd.invocation')).toHaveLength(0);
    await page.screenshot({ path: resolve(__dirname, `../../../apps/e2e/outputs/qa-run-${run}/assets/command-awaiting-denial.png`) });
    await cancel.click();
    await expect(page.getByRole('heading', { name: marker, exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
    await expect.poll(async () => (await request.get(`${API_BASE}/sessions/${session}/runs/current`)).text()).toBe('');
    await sendMessageFromComposer(page, `Bez narzędzi i zmian. Odpowiedz wyłącznie nagłówkiem ## ${followup} i zdaniem: Rozmowa działa po odmowie.`);
    await expect(page.getByRole('heading', { name: followup, exact: true })).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await request.get(`${API_BASE}/sessions/${session}/runs/current`)).text()).toBe('');
    const entries = await audit();
    expect(entries.filter(entry => entry.type === 'tool_call')).toHaveLength(1);
    expect(entries.filter(entry => entry.label === 'process.cmd.invocation')).toHaveLength(0);
    expect(entries.filter(entry => entry.label === 'tool.confirmation.denied')).toHaveLength(1);
    expect(entries.filter(entry => entry.label === 'llm.turn.completed')).toHaveLength(2);
    const after = await hosts();
    expect(after).toHaveLength(1);
    expect(after[0].processEpoch).toBe(epoch);
    await page.reload();
    await expect(page.getByRole('heading', { name: marker, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: followup, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('chat-connection-status')).toHaveCount(0, { timeout: 30_000 });
    await page.screenshot({ path: resolve(__dirname, `../../../apps/e2e/outputs/qa-run-${run}/assets/denied-followup-after-f5.png`) });
  } finally {
    if (await cancel.isVisible()) await cancel.click();
    const stop = page.getByRole('button', { name: 'Stop agent', exact: true });
    if (await stop.isVisible()) await stop.click();
  }
});
