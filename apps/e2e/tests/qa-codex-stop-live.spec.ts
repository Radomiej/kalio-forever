import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { API_BASE, APP_BASE, selectSession, sendMessageFromComposer } from './helpers/test-config';

test.skip(process.env['KALIO_CODEX_STOP'] !== '1', 'Approved real no-tool Codex Stop only');
test('Codex visible Stop drains and a fresh follow-up completes without host reset', async ({ page, request }) => {
  test.setTimeout(120_000);
  expect(APP_BASE.replace(/\/$/, '')).toBe('http://localhost:5288');
  const session = 'yvD83rgDA_ZHvUwJKlo_S';
  const stamp = Date.now();
  const first = `QA147_STOP_${stamp}`;
  const final = `QA147_FINAL_${stamp}`;
  const host = async () => {
    const hosts = await (await request.get(`${API_BASE}/runtime/native-cli-integrations`)).json();
    return hosts.find((item: { provider: string; authProfileId: string }) => item.provider === 'codex' && item.authProfileId === 'chatgpt-default');
  };
  const epoch = (await host()).processEpoch;
  expect(typeof epoch).toBe('string');
  await page.goto('/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, session, 'Codex Stop');
  const stop = page.getByRole('button', { name: 'Stop agent', exact: true });
  try {
    await sendMessageFromComposer(page, `Test Stop. Bez jakichkolwiek narzędzi, plików, terminala, web i zmian projektu. Zacznij nagłówkiem ## ${first}, potem podaj 100 wskazówek dla strony firmy IT, po dwa zdania. Użytkownik zatrzyma generowanie.`);
    await expect(page.getByRole('heading', { name: first, exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(stop).toBeVisible();
    await stop.click();
    await expect(stop).toHaveCount(0, { timeout: 30_000 });
    await sendMessageFromComposer(page, `Nowy turn po Stop. Nie kontynuuj listy. Bez jakichkolwiek narzędzi i zmian. Odpowiedz tylko nagłówkiem ## ${final} i zdaniem: Kontynuacja po zatrzymaniu działa.`);
    await expect(page.getByRole('heading', { name: final, exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(stop).toHaveCount(0);
    await expect(page.getByTestId('chat-queued-badge')).toHaveCount(0);
    expect((await host()).processEpoch).toBe(epoch);
    const audit = await (await request.get(`${API_BASE}/audit-log?sessionId=${session}&since=${stamp}&source=all&limit=2000`)).json() as { type: string; label: string }[];
    expect(audit.some(entry => entry.label === 'llm.turn.cancelled')).toBe(true);
    expect(audit.filter(entry => entry.type === 'tool_call')).toHaveLength(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: final, exact: true })).toBeVisible();
    const partial = page.getByTestId('agent-turn-bubble').filter({ hasText: first });
    await expect(partial.getByTestId('turn-error-indicator')).toContainText('Interrupted');
    await expect(page.getByTestId('chat-connection-status')).toHaveCount(0, { timeout: 30_000 });
    await page.screenshot({ path: resolve(__dirname, '../../../docs/raports/qa-run-147/assets/codex-stop-followup-after-f5.png') });
  } finally { if (await stop.isVisible()) await stop.click(); }
});
