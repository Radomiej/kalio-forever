import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import type { ChatMessage } from '@kalio/types';
import { API_BASE, selectSession, sendMessageFromComposer } from './helpers/test-config';

const reportRun = process.env['KALIO_DEVIN_HOST_RESET_REPORT_RUN'] ?? '155';
if (!/^[1-9]\d*$/.test(reportRun)) throw new Error('Numeric report run required');

test.skip(process.env['KALIO_DEVIN_HOST_RESET'] !== '1', 'Explicit authorized reset of the sole QA Devin host');
test('host reset terminates a no-tool turn and the same Devin chat answers again', async ({ page, request }) => {
  test.setTimeout(120_000);
  const session = 'W4fggLSunrJB41C24MV7C';
  const stamp = Date.now();
  const partial = `QA${reportRun}_RESET_${stamp}`;
  const final = `QA${reportRun}_RECOVERED_${stamp}`;
  const status = await (await request.get(`${API_BASE}/runtime/devin-cli/status`)).json();
  expect(status.hosts).toHaveLength(1);
  expect(status.hosts[0].model).toBe('swe-2');
  const epoch = status.hosts[0].processEpoch;
  const settingsBefore = await (await request.get(`${API_BASE}/runtime/devin-cli/settings`)).json();
  expect(settingsBefore.nativeTools).toMatchObject({ filesystem: false, web: false, terminal: false });
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, session, 'Devin host reset recovery');
  const stop = page.getByRole('button', { name: 'Stop agent', exact: true });
  try {
    await sendMessageFromComposer(page, `Model dokładnie swe-2. Test resetu hosta; bez jakichkolwiek narzędzi, plików, terminala, web i zmian projektu. Zacznij nagłówkiem ## ${partial}, potem wypisz 100 długich wskazówek dla strony firmy IT, po trzy zdania. Host będzie zresetowany podczas generowania.`);
    await expect(page.getByRole('heading', { name: partial, exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(stop).toBeVisible();
    const history = await (await request.get(`${API_BASE}/sessions/${session}/messages`)).json() as ChatMessage[];
    const prompt = history.find(message => message.role === 'user' && message.createdAt >= stamp && message.content.includes(partial));
    expect(prompt?.turnId).toBeTruthy();
    await page.screenshot({ path: resolve(__dirname, `../../../apps/e2e/outputs/qa-run-${reportRun}/assets/before-host-reset.png`) });
    // Existing settings endpoint resets hosts. Empty payload changes no token or native-tool boolean.
    const reset = await request.patch(`${API_BASE}/runtime/devin-cli/settings`, { data: {} });
    expect(reset.ok()).toBe(true);
    expect(await reset.json()).toEqual(settingsBefore);
    await expect(stop).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(async () => (await request.get(`${API_BASE}/sessions/${session}/runs/current`)).text()).toBe('');
    const runResponse = await request.get(`${API_BASE}/sessions/${session}/runs/history?turnIds=${prompt!.turnId!}`);
    expect(runResponse.ok()).toBe(true);
    const outcomes = await runResponse.json() as { status: string; errorMessage?: string }[];
    expect(outcomes).toHaveLength(1);
    expect(['failed', 'interrupted', 'cancelled', 'interrupted_needs_retry']).toContain(outcomes[0].status);
    expect(outcomes[0].errorMessage).toBe('Turn interrupted because the external agent runtime was lost.');
    await page.reload();
    const bubble = page.getByTestId('agent-turn-bubble').filter({ hasText: partial });
    await expect(bubble.getByTestId('turn-error-indicator')).toBeVisible();
    await expect(page.getByTestId('chat-connection-status')).toHaveCount(0, { timeout: 30_000 });
    await sendMessageFromComposer(page, `Nowa tura po resecie hosta, dokładnie swe-2. Nie kontynuuj listy. Bez jakichkolwiek narzędzi i zmian. Odpowiedz tylko nagłówkiem ## ${final} i zdaniem: Rozmowa działa po resecie hosta.`);
    await expect(page.getByRole('heading', { name: final, exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(stop).toHaveCount(0);
    const after = await (await request.get(`${API_BASE}/runtime/devin-cli/status`)).json();
    expect(after.hosts).toHaveLength(1);
    expect(after.hosts[0].model).toBe('swe-2');
    expect(after.hosts[0].processEpoch).not.toBe(epoch);
    expect(await (await request.get(`${API_BASE}/runtime/devin-cli/settings`)).json()).toEqual(settingsBefore);
    const audit = await (await request.get(`${API_BASE}/audit-log?sessionId=${session}&since=${stamp}&source=all&limit=2000`)).json() as { type: string; label: string }[];
    expect(audit.filter(entry => entry.type === 'tool_call')).toHaveLength(0);
    expect(audit.filter(entry => entry.label === 'process.cmd.invocation')).toHaveLength(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: final, exact: true })).toBeVisible();
    await expect(page.getByTestId('chat-connection-status')).toHaveCount(0, { timeout: 30_000 });
    await page.screenshot({ path: resolve(__dirname, `../../../apps/e2e/outputs/qa-run-${reportRun}/assets/recovered-after-f5.png`) });
  } finally {
    if (await stop.isVisible()) await stop.click();
  }
});
