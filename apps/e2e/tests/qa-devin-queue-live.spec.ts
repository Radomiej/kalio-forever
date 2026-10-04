import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { APP_BASE, API_BASE, selectSession, sendMessageFromComposer } from './helpers/test-config';

const codex = process.env['KALIO_CODEX_QUEUE'] === '1';
test.skip(!codex && process.env['KALIO_DEVIN_QUEUE'] !== '1', 'Approved real no-tool queue test only');
test('CLI agent executes a queued follow-up after its active turn and survives F5', async ({ page, request }) => {
  test.setTimeout(120_000);
  expect(APP_BASE.replace(/\/$/, '')).toBe('http://localhost:5288');
  const session = codex ? 'yvD83rgDA_ZHvUwJKlo_S' : 'W4fggLSunrJB41C24MV7C';
  const report = process.env['KALIO_CLI_QUEUE_REPORT_RUN'];
  if (!report || !/^[1-9]\d*$/.test(report)) throw new Error('Explicit numeric queue report run required');
  const expectedModel = codex ? 'gpt-6-luna' : 'swe-2';
  const beforeHostResponse = codex ? null : await request.get(`${API_BASE}/runtime/devin-cli/status`);
  if (beforeHostResponse) expect(beforeHostResponse.ok()).toBeTruthy();
  const beforeHost = beforeHostResponse ? await beforeHostResponse.json() as { hosts: Array<{ model: string; processEpoch: string }> } : null;
  if (beforeHost) {
    expect(beforeHost.hosts).toHaveLength(1);
    expect(beforeHost.hosts[0].model).toBe(expectedModel);
    expect(beforeHost.hosts[0].processEpoch).toBeTruthy();
  }
  const stamp = Date.now();
  const first = `QA${report}_FIRST_${stamp}`;
  const second = `QA${report}_SECOND_${stamp}`;
  await page.goto('/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, session, codex ? 'Codex queue' : 'Devin queue');
  await sendMessageFromComposer(page, `Test kolejki bez narzędzi. Model dokładnie ${codex ? 'gpt-6-luna' : 'swe-2'}. Bez plików, terminala, web, zmian projektu. Zacznij nagłówkiem ## ${first}, następnie podaj 40 numerowanych wskazówek dla strony firmy IT, po dwa zdania. To pierwszy turn testu kolejki.`);
  const stop = page.getByRole('button', { name: 'Stop agent', exact: true });
  try {
    await expect(stop).toBeVisible({ timeout: 30_000 });
    const active = await (await request.get(`${API_BASE}/sessions/${session}/runs/current`)).json();
    expect(active.status).toBe('active');
    await page.getByTestId('chat-input').fill(`Drugi turn testu kolejki. Bez jakichkolwiek narzędzi i zmian. Nie kontynuuj listy. Odpowiedz tylko nagłówkiem ## ${second} i zdaniem: Kolejka została obsłużona.`);
    await page.getByTestId('chat-input').press('Enter');
    await expect(page.getByTestId('chat-queued-badge')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${report}/assets/queued-followup.png`) });
    await page.reload();
    await expect(page.getByRole('heading', { name: second, exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(stop).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('chat-queued-badge')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: first, exact: true })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: second, exact: true })).toHaveCount(1);
    const response = await request.get(`${API_BASE}/audit-log?sessionId=${session}&since=${stamp}&source=all&limit=2000`);
    expect(response.ok()).toBeTruthy();
    const entries = await response.json() as { type: string; label: string; createdAt: number; data?: { turnId?: string; provider?: string; model?: string } }[];
    expect(entries.filter(entry => entry.type === 'tool_call')).toHaveLength(0);
    expect(entries.filter(entry => entry.label === 'process.cmd.invocation')).toHaveLength(0);
    const starts = entries.filter(entry => entry.label === 'llm.turn.started').sort((left, right) => left.createdAt - right.createdAt);
    const completed = entries.filter(entry => entry.label === 'llm.turn.completed');
    expect(starts).toHaveLength(2);
    expect(completed).toHaveLength(2);
    const turnIds = starts.map(entry => entry.data?.turnId);
    expect(turnIds.every(id => typeof id === 'string' && /^[\w-]+$/.test(id))).toBe(true);
    const historyResponse = await request.get(`${API_BASE}/sessions/${session}/runs/history?turnIds=${encodeURIComponent(turnIds.join(','))}`);
    expect(historyResponse.ok()).toBeTruthy();
    const runs = await historyResponse.json() as Array<{ turnId: string; provider: string; model: string; status: string }>;
    expect(runs).toHaveLength(2);
    for (const entry of starts) {
      expect(entry.data?.model).toBe(expectedModel);
      const run = runs.find(candidate => candidate.turnId === entry.data?.turnId);
      expect(run?.provider).toBe(codex ? 'codex-app-server' : 'devin-cli-acp');
      expect(run?.model).toBe(expectedModel);
      expect(run?.status).toBe('completed');
    }
    expect(completed.find(entry => entry.data?.turnId === active.turnId)?.createdAt).toBeLessThanOrEqual(starts[1].createdAt);
    if (beforeHost) {
      const afterResponse = await request.get(`${API_BASE}/runtime/devin-cli/status`);
      expect(afterResponse.ok()).toBeTruthy();
      const after = await afterResponse.json() as { hosts: Array<{ processEpoch: string }> };
      expect(after.hosts).toHaveLength(1);
      expect(after.hosts[0].processEpoch).toBe(beforeHost.hosts[0].processEpoch);
    }
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${report}/assets/queue-drained-after-f5.png`) });
  } finally {
    if (await stop.isVisible()) await stop.click();
  }
});
