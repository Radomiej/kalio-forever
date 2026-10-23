import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { API_BASE, APP_BASE, selectSession } from './helpers/test-config';

test.skip(process.env['KALIO_NATIVE_AUDIT_READONLY'] !== '1', 'Explicit fixed-QA read-only check');
test('native audit is scoped to the saved Devin turn and absent from Codex', async ({ page, request }) => {
  expect(APP_BASE.replace(/\/$/, '')).toBe('http://localhost:5288');
  const reportRun = process.env['KALIO_NATIVE_AUDIT_REPORT_RUN'] ?? '255';
  if (!/^[1-9]\d*$/.test(reportRun)) throw new Error('Numeric report run required');
  const session = 'W4fggLSunrJB41C24MV7C';
  const turn = 'HccFyxg08nDpfWthfFpDe';
  const heading = 'QA245_BUILD_1791117163193_RESULT';
  const auditRequests: URL[] = [];
  page.on('request', req => {
    const url = new URL(req.url());
    if (url.pathname === '/api/audit-log' && url.searchParams.get('type') === 'runtime_event') auditRequests.push(url);
  });
  const before = await (await request.get(`${API_BASE}/sessions/${session}/messages`)).text();
  await page.goto('/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, session, 'Saved Devin audit');
  const bubble = page.getByTestId('agent-turn-bubble').filter({ has: page.getByRole('heading', { name: heading, exact: true }) });
  const panel = bubble.getByTestId('native-tool-audit-panel');
  await expect(panel).toHaveCount(1);
  const toggle = panel.getByRole('button', { name: 'Devin native tool audit', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(auditRequests).toHaveLength(0);
  const response = page.waitForResponse(res => {
    const url = new URL(res.url());
    return url.pathname === '/api/audit-log' && url.searchParams.get('turnId') === turn && url.searchParams.get('type') === 'runtime_event';
  });
  await toggle.click();
  expect((await response).ok()).toBe(true);
  await expect(panel.getByRole('button', { name: 'Refresh native audit', exact: true })).toBeEnabled();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel).toContainText('Approval does not prove execution.');
  expect(auditRequests).toHaveLength(1);
  expect(auditRequests[0].searchParams.get('sessionId')).toBe(session);
  expect(auditRequests[0].searchParams.get('turnId')).toBe(turn);
  await page.screenshot({ path: resolve(__dirname, `../../../apps/e2e/outputs/qa-run-${reportRun}/assets/devin-scoped-audit.png`) });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(auditRequests).toHaveLength(1);
  expect(await (await request.get(`${API_BASE}/sessions/${session}/messages`)).text()).toBe(before);

  await selectSession(page, 'yvD83rgDA_ZHvUwJKlo_S', 'Saved Codex audit boundary');
  const codex = page.getByTestId('agent-turn-bubble').filter({ has: page.getByRole('heading', {
    name: 'QA247_CODEX_FOLLOWUP_1791117414416', exact: true,
  }) });
  await expect(codex).toHaveCount(1);
  await expect(codex.getByTestId('native-tool-audit-panel')).toHaveCount(0);
  await page.screenshot({ path: resolve(__dirname, `../../../apps/e2e/outputs/qa-run-${reportRun}/assets/codex-no-devin-audit.png`) });
});
