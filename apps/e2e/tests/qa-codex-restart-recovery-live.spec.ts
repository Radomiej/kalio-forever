import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { API_BASE, selectSession, sendMessageFromComposer } from './helpers/test-config';

test.skip(process.env['KALIO_CODEX_RESTART_RECOVERY'] !== '1', 'Explicit authorized real ChatGPT/Codex communication');
test('existing ChatGPT conversation recovers after backend restart and accepts a warm follow-up', async ({ page, request }) => {
  test.setTimeout(120_000);
  const session = 'yvD83rgDA_ZHvUwJKlo_S';
  const started = Date.now();
  const reportRun = process.env['KALIO_CODEX_RESTART_REPORT_RUN'] ?? '160';
  if (!/^\d+$/.test(reportRun)) throw new Error('Report run must be numeric');
  const host = async () => {
    const statuses = await (await request.get(`${API_BASE}/runtime/native-cli-integrations`)).json() as { provider: string; authProfileId: string; connected: boolean; processEpoch: string }[];
    const current = statuses.find(item => item.provider === 'codex' && item.authProfileId === 'chatgpt-default');
    expect(current?.connected).toBe(true);
    return current!;
  };
  const epoch = (await host()).processEpoch;
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, session, 'ChatGPT restart recovery');
  const stop = page.getByRole('button', { name: 'Stop agent', exact: true });
  try {
    for (const phase of ['RECOVERED', 'FOLLOWUP']) {
      const marker = `QA${reportRun}_CODEX_${phase}_${started}`;
      await sendMessageFromComposer(page, `Test komunikacji ChatGPT/Codex, model gpt-6-luna. Bez narzędzi, plików, terminala, web ani zmian projektu. Odpowiedz tylko nagłówkiem ## ${marker} i zdaniem: Rozmowa działa poprawnie.`);
      await expect(page.getByRole('heading', { name: marker, exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(stop).toHaveCount(0);
      await expect.poll(async () => (await request.get(`${API_BASE}/sessions/${session}/runs/current`)).text()).toBe('');
      expect((await host()).processEpoch).toBe(epoch);
      await page.reload();
      await expect(page.getByRole('heading', { name: marker, exact: true })).toBeVisible();
      await expect(page.getByTestId('chat-connection-status')).toHaveCount(0, { timeout: 30_000 });
    }
    const entries = await (await request.get(`${API_BASE}/audit-log?sessionId=${session}&since=${started}&source=all&limit=2000`)).json() as { type: string; label: string }[];
    expect(entries.filter(entry => entry.type === 'tool_call')).toHaveLength(0);
    expect(entries.filter(entry => entry.label === 'process.cmd.invocation')).toHaveLength(0);
    expect(entries.filter(entry => entry.label === 'llm.turn.completed')).toHaveLength(2);
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/codex-recovery-after-f5.png`) });
  } finally {
    if (await stop.isVisible()) await stop.click();
  }
});
