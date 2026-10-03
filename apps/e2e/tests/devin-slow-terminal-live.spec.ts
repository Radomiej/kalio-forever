import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { selectSession } from './helpers/test-config';

const live = process.env['KALIO_DEVIN_SLOW_QA87'] === '1';
test.skip(!live, 'Explicit authorized real SWE-2 QA87 workflow only; not a mock test.');

test('real SWE-2 observes a delayed process through approved Kalio UI tools', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, 'W4fggLSunrJB41C24MV7C', 'New Chat');
  await expect(page.getByText('Devin CLI · swe-2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  const command = { command: 'node', args: ['-e', '"setTimeout(()=>console.log(\'QA87_SLOW_OK\'),12000)"'], cwd: 'E:/Projekty/home-site' };
  await page.getByRole('textbox', { name: 'Chat message', exact: true }).fill(
    `QA87 pomiar odczytu terminala. Model dokładnie swe-2. Użyj wyłącznie Kalio terminal_spawn z dokładnym JSON ${JSON.stringify(command)}. ` +
    'Poczekaj na zatwierdzenie. Następnie terminal_output z id zwróconego terminala i waitMs 30000, w tej samej turze. ' +
    'Nie używaj innych narzędzi, native tools ani plików; nie uruchamiaj nic drugi raz. Proces tylko wypisuje marker po 12 sekundach. Podaj rzeczywisty końcowy status, exitCode, output i id terminala.'
  );
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: 'Toggle args', exact: true }).click();
  const argumentsRegion = page.getByRole('region', { name: 'Full tool arguments', exact: true }).last();
  await expect(argumentsRegion).toContainText('QA87_SLOW_OK');
  await expect(argumentsRegion).toContainText('12000');
  await expect(argumentsRegion).toContainText('E:/Projekty/home-site');
  await expect(argumentsRegion).toContainText('node');
  await page.screenshot({ path: resolve(__dirname, '../../../docs/raports/qa-run-87/assets/slow-process-approval.png') });
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0, { timeout: 90000 });
  await expect(page.getByText('Kalio is responding.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Toggle details', exact: true }).last().click();
  await expect(page.getByRole('region', { name: 'Full tool arguments', exact: true }).last()).toContainText('30000');
  await expect(page.getByText(/"exitCode": 0/).last()).toBeVisible();
  await expect(page.getByText(/"output":.*QA87_SLOW_OK/).last()).toBeVisible();
  await page.screenshot({ path: resolve(__dirname, '../../../docs/raports/qa-run-87/assets/slow-process-completed.png') });
});

test('restore approved HomeSite preview through the real Devin UI', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, 'W4fggLSunrJB41C24MV7C', 'New Chat');
  await expect(page.getByText('Devin CLI · swe-2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Chat message', exact: true }).fill(
    'Przywróć QA87 preview HomeSite. Model dokładnie swe-2. Wyłącznie Kalio terminal_spawn: command npm, args ["run","preview","--","--host","127.0.0.1","--port","57868","--strictPort"], cwd E:/Projekty/home-site. ' +
    'Zaczekaj na zatwierdzenie, potem terminal_output zwróconego terminala bez waitMs, bo preview ma pozostać running. Bez innych/natywnych narzędzi, zmian plików, builda, commitów i deployu.'
  );
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: 'Toggle args', exact: true }).click();
  const args = page.getByRole('region', { name: 'Full tool arguments', exact: true }).last();
  for (const part of ['npm', 'preview', '127.0.0.1', '57868', '--strictPort', 'E:/Projekty/home-site']) {
    await expect(args).toContainText(part);
  }
  await page.screenshot({ path: resolve(__dirname, '../../../docs/raports/qa-run-87/assets/preview-approval.png') });
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0, { timeout: 90000 });
  await page.getByRole('button', { name: 'Toggle details', exact: true }).last().click();
  await expect(page.getByText(/"status": "running"/).last()).toBeVisible();
  await expect(page.getByText(/"output":.*57868/).last()).toBeVisible();
  await page.screenshot({ path: resolve(__dirname, '../../../docs/raports/qa-run-87/assets/preview-completed.png') });
});
