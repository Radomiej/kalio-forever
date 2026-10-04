import { expect, test } from '@playwright/test';
import type { AuditLogEntry, ChatMessage } from '@kalio/types';
import { resolve } from 'node:path';
import { selectSession } from './helpers/test-config';

test.skip(process.env['KALIO_DEVIN_NATIVE_DENIAL_LIVE'] !== '1', 'Explicit authorized SWE-2 native denial only');

test('real Devin native tool is denied and its evidence survives reload', async ({ page }) => {
  test.setTimeout(180000);
  const sessionId = 'W4fggLSunrJB41C24MV7C';
  const api = 'http://127.0.0.1:3316/api';
  const reportRun = process.env['KALIO_DEVIN_NATIVE_DENIAL_REPORT_RUN'] ?? '102';
  if (!/^\d+$/.test(reportRun)) throw new Error('Report run must be numeric');
  const kind = process.env['KALIO_DEVIN_NATIVE_DENIAL_KIND'] ?? 'read';
  if (kind !== 'read' && kind !== 'execute') throw new Error('Only read or harmless execute denial is supported');
  const marker = `QA${reportRun}_NATIVE_${kind.toUpperCase()}_DENIAL`;
  const attempt = kind === 'read'
    ? 'Spróbuj dokładnie jeden NATYWNY Devin Read na E:/Projekty/home-site/package.json. Nie używaj terminala. '
    : `Spróbuj dokładnie jeden NATYWNY Devin exec w E:/Projekty/home-site: node -e "process.stdout.write('QA${reportRun}_NATIVE_EXEC_MARKER')". `;
  const shot = (name: string) => resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/${name}.png`);
  const statusResponse = await page.request.get(`${api}/runtime/devin-cli/status`);
  expect(statusResponse.ok()).toBe(true);
  const status = await statusResponse.json() as Record<string, unknown>;
  expect(status).toMatchObject({ authenticated: true, acp: true, modelCatalogStatus: 'ready', modelCatalogStale: false, hostCount: 0 });
  expect(typeof status['modelCatalogDiscoveredAt']).toBe('number');
  expect(Date.now() - (status['modelCatalogDiscoveredAt'] as number)).toBeLessThan(300000);
  const submittedAt = Date.now();
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, sessionId, 'New Chat');
  const input = page.getByRole('textbox', { name: 'Chat message', exact: true });
  await expect(input).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Devin CLI · swe-2', { exact: true })).toBeVisible();
  const stop = page.getByRole('button', { name: 'Stop agent', exact: true });
  await expect(stop).toHaveCount(0);
  console.log((await page.locator('body').ariaSnapshot()).slice(-1600));
  await input.fill(`${marker}: kontrolowany test odmowy natywnego narzędzia. Model dokładnie swe-2. ` +
    attempt +
    'Oczekujemy odmowy polityki. Nie używaj żadnych narzędzi Kalio ani fallbacku. Nie używaj web, zapisów ani innych plików. ' +
    `Po odmowie zakończ nagłówkiem ## ${marker}_RESULT i opisz tylko rzeczywisty wynik; nie twierdź, że narzędzie wywołano bez próby.`);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  try {
    let turnId = '';
    await expect.poll(async () => {
      const response = await page.request.get(`${api}/sessions/${sessionId}/messages`);
      expect(response.ok()).toBe(true);
      const messages = await response.json() as ChatMessage[];
      turnId = messages.find(m => m.role === 'user' && m.createdAt >= submittedAt && m.content.startsWith(marker))?.turnId ?? '';
      return turnId;
    }).not.toBe('');
    let audit: AuditLogEntry[] = [];
    await expect.poll(async () => {
      const response = await page.request.get(`${api}/audit-log?sessionId=${sessionId}&turnId=${turnId}&source=all&limit=2000`);
      expect(response.ok()).toBe(true);
      audit = await response.json() as AuditLogEntry[];
      expect(audit.length).toBeLessThan(2000);
      return audit.filter(e => e.label === 'llm.turn.completed').length;
    }, { timeout: 120000 }).toBe(1);
    await expect(stop).toHaveCount(0);
    await page.screenshot({ path: shot(`native-${kind}-result`), fullPage: true });
    const approvals = audit.filter(e => e.label === 'devin-cli-acp.native_approval');
    console.log(JSON.stringify({ turnId, since: submittedAt, auditRows: audit.length, nativeApprovals: approvals.map(e => ({
      id: e.id, decision: e.data?.['decision'], source: e.data?.['decisionSource'], category: e.data?.['category'],
    })) }));
    for (const entry of approvals) expect(entry.data).toMatchObject({ decision: 'decline', decisionSource: 'policy', categoryEnabled: false });
    const nativeAttempts = audit.filter(e => e.label === 'devin-cli-acp.tool' && e.data?.['kind'] === kind);
    expect(nativeAttempts).toHaveLength(1);
    const callId = nativeAttempts[0]!.data!['toolCallId'];
    for (const entry of approvals) expect(entry.data?.['toolCallId']).toBe(callId);
    const activity = audit.filter(e => e.label === 'devin-cli-acp.tool' && e.data?.['toolCallId'] === callId);
    expect(activity.some(e => e.data?.['toolStatus'] === 'completed')).toBe(false);
    const failure = activity.find(e => e.data?.['toolStatus'] === 'failed');
    if (approvals.length === 0) {
      expect(failure?.data, 'Failed status alone is not a permission outcome').toMatchObject({ outputPresent: true, permissionMentionedInFailure: true });
    }
    expect(audit.filter(e => e.label === 'process.cmd.invocation')).toHaveLength(0);
    const open = async () => {
      const response = page.waitForResponse(r => r.url().includes('/api/audit-log?') && new URL(r.url()).searchParams.get('turnId') === turnId);
      await page.getByRole('button', { name: 'Native tool audit', exact: true }).last().click();
      expect((await response).ok()).toBe(true);
      const panel = page.getByTestId('native-tool-audit-panel').last();
      await expect(panel).toContainText(String(callId));
      await expect(panel).toContainText(approvals.length ? 'blocked by policy' : 'Native Devin · failed');
    };
    await open();
    await page.reload();
    await open();
    await page.screenshot({ path: shot('native-denial-after-f5'), fullPage: true });
  } finally {
    if (await stop.isVisible()) await stop.click();
  }
});
