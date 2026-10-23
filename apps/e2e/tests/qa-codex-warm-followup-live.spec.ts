import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { API_BASE, APP_BASE, selectSession, sendMessageFromComposer } from './helpers/test-config';

test.skip(process.env['KALIO_CODEX_WARM_FOLLOWUP'] !== '1', 'Explicit approved live follow-up only');
test('existing Codex thread answers without resetting its host', async ({ page, request }) => {
  expect(APP_BASE.replace(/\/$/, '')).toBe('http://localhost:5288');
  const session = 'yvD83rgDA_ZHvUwJKlo_S';
  const hosts = await (await request.get(`${API_BASE}/runtime/native-cli-integrations`)).json();
  const before = hosts.find((host: { provider: string; authProfileId: string }) => host.provider === 'codex' && host.authProfileId === 'chatgpt-default');
  expect(before.connected).toBe(true);
  expect(before.openSessionCount).toBeGreaterThan(0);
  const epoch = before.processEpoch;
  expect(typeof epoch).toBe('string');
  const marker = `QA136_WARM_${Date.now()}`;
  await page.goto('/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, session, 'Codex warm follow-up');
  await sendMessageFromComposer(page, `Test komunikacji w istniejącym czacie. Bez żadnych narzędzi, plików, terminala, web ani zmian projektu. Odpowiedz nagłówkiem ## ${marker} i jednym zdaniem po polsku: Rozmowa działa bez resetowania hosta.`);
  await expect(page.getByRole('heading', { name: marker, exact: true })).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await request.get(`${API_BASE}/sessions/${session}/runs/current`)).text(), { timeout: 30_000 }).toBe('');
  const afterHosts = await (await request.get(`${API_BASE}/runtime/native-cli-integrations`)).json();
  expect(afterHosts.find((host: { provider: string; authProfileId: string }) => host.provider === 'codex' && host.authProfileId === 'chatgpt-default').processEpoch).toBe(epoch);
  await page.reload();
  await expect(page.getByRole('heading', { name: marker, exact: true })).toBeVisible();
  await expect(page.getByTestId('chat-connection-status')).toHaveCount(0, { timeout: 30_000 });
  await page.screenshot({ path: resolve(__dirname, '../../../apps/e2e/outputs/qa-run-136/assets/codex-warm-followup.png') });
});
