import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { selectSession } from './helpers/test-config';

test.skip(process.env['KALIO_NATIVE_AUDIT_READONLY'] !== '1', 'Explicit fixed QA read-only audit');
test('recorded Codex HomeSite turn does not display Devin native audit after F5', async ({ page }) => {
  const run = process.env['KALIO_NATIVE_AUDIT_SCOPE_RUN'] ?? '188';
  if (!/^[1-9]\d*$/.test(run)) throw new Error('Numeric report run required');
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, 'yvD83rgDA_ZHvUwJKlo_S', 'ChatGPT HomeSite read');
  for (let reload = 0; reload < 2; reload++) {
    const turn = page.getByTestId('agent-turn-bubble').filter({ hasText: 'QA187_CODEX_READ_1791107469085_RESULT' });
    await expect(turn.getByTestId('tool-execution-origin')).toHaveText('Kalio');
    await expect(turn.getByTestId('native-tool-audit-panel')).toHaveCount(0);
    if (!reload) await page.reload();
  }
  await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${run}/assets/codex-without-devin-audit.png`) });
});
test('native audit states its Devin-only scope without claiming absent evidence is no execution', async ({ page }) => {
  const run = process.env['KALIO_NATIVE_AUDIT_SCOPE_RUN'] ?? '186';
  if (!/^[1-9]\d*$/.test(run)) throw new Error('Numeric report run required');
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, 'W4fggLSunrJB41C24MV7C', 'HomeSite audit scope');
  const open = async () => {
    const panel = page.getByTestId('native-tool-audit-panel').last();
    const response = page.waitForResponse(result => result.url().includes('/api/audit-log?')
      && new URL(result.url()).searchParams.get('turnId') === 'OzSjtuCsZ7ZITyzYOVqvH');
    await panel.getByRole('button', { name: 'Devin native tool audit', exact: true }).click();
    expect((await response).ok()).toBe(true);
    await expect(panel).toContainText('does not report native tools from other providers');
    await expect(panel).toContainText('Approval does not prove execution');
    await expect(panel).toContainText('No correlated native evidence for this turn');
    return panel;
  };
  await open();
  await page.reload();
  const panel = await open();
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${run}/assets/devin-audit-scope.png`) });
});
