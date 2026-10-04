import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { selectSession } from './helpers/test-config';

test.skip(process.env['KALIO_DEVIN_PREVIEW_HISTORY_QA100'] !== '1', 'Read-only existing QA99 turn only');
test('existing preview turn exposes its own Kalio result after reload', async ({ page }) => {
  const terminalId = 'Dd51uzNehRl0Dq7HwYaDT';
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, 'W4fggLSunrJB41C24MV7C', 'New Chat');
  await expect(page.getByRole('textbox', { name: 'Chat message', exact: true })).toBeVisible({ timeout: 30000 });
  console.log((await page.locator('body').ariaSnapshot()).slice(-4500));
  const turn = page.getByTestId('agent-turn-bubble').filter({ hasText: terminalId });
  await expect(turn).toHaveCount(1);
  const result = turn.locator('[data-testid="tool-call-bubble"][data-tool-name="terminal_output"]').last();
  await expect(result.getByTestId('tool-execution-origin')).toHaveText('Kalio');
  await result.getByRole('button', { name: 'Toggle details', exact: true }).click();
  await expect(result).toContainText(terminalId);
  await expect(result).toContainText(/"status":\s*"running"/);
  await expect(result).toContainText('57868');
  await page.screenshot({ path: resolve(__dirname, '../../../docs/raports/qa-run-100/assets/current-preview-result.png') });
  await page.reload();
  await expect(turn).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  await result.getByRole('button', { name: 'Toggle details', exact: true }).click();
  await expect(result).toContainText(terminalId);
  await expect(result).toContainText(/"status":\s*"running"/);
  await page.screenshot({ path: resolve(__dirname, '../../../docs/raports/qa-run-100/assets/current-preview-result-after-f5.png') });
});
