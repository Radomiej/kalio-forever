import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { selectSession } from './helpers/test-config';

test.skip(process.env['KALIO_DEVIN_STOP_QA90'] !== '1', 'Authorized real SWE-2 stop/HITL/follow-up QA only.');
test('real Devin Stop cancels a pending command and accepts a read-only follow-up', async ({ page }) => {
  test.setTimeout(180000);
  const sessionId = 'W4fggLSunrJB41C24MV7C';
  const screenshot = (name: string) => resolve(__dirname, `../../../docs/raports/qa-run-90/assets/${name}.png`);
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, sessionId, 'New Chat');
  await expect(page.getByText('Devin CLI · swe-2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  console.log((await page.locator('body').ariaSnapshot()).slice(-5500));
  const command = { command: 'node', args: ['-e', '"console.log(\'QA90_MUST_NOT_RUN\')"'], cwd: 'E:/Projekty/home-site' };
  await page.getByRole('textbox', { name: 'Chat message', exact: true }).fill(
    `QA90_STOP test przerwania. Model dokładnie swe-2. Poproś o jeden Kalio terminal_spawn z dokładnym JSON ${JSON.stringify(command)}. ` +
    'Czekaj na ręczne zatwierdzenie. Nie używaj innych ani natywnych narzędzi, nie ponawiaj polecenia, nie zmieniaj plików. Polecenie ma pozostać niezatwierdzone.'
  );
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: 'Toggle args', exact: true }).last().click();
  await expect(page.getByRole('region', { name: 'Full tool arguments', exact: true }).last()).toContainText('QA90_MUST_NOT_RUN');
  await page.screenshot({ path: screenshot('pending-unapproved-command') });
  await page.getByRole('button', { name: 'Stop agent', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0, { timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
  await expect(page.getByText('Kalio is responding.', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: screenshot('stopped-before-follow-up') });
  await page.getByRole('textbox', { name: 'Chat message', exact: true }).fill(
    'QA90_FOLLOW_UP: po Stop wykonaj dokładnie jeden Kalio fs_read path E:/Projekty/home-site/package.json. Model swe-2. ' +
    'Nie wykonuj poprzedniego polecenia, terminala, native tools ani zmian plików. Zakończ odpowiedzią z nagłówkiem ## QA90_FOLLOW_UP_RESULT i nazwą projektu z pliku.'
  );
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'QA90_FOLLOW_UP_RESULT', exact: true })).toBeVisible({ timeout: 90000 });
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('chat-queued-badge')).toHaveCount(0);
  await expect(page.getByText('Kalio is responding.', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'QA90_FOLLOW_UP_RESULT', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  await page.screenshot({ path: screenshot('follow-up-completed-after-f5') });
});
