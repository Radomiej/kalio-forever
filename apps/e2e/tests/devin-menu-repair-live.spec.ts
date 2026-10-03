import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { selectSession } from './helpers/test-config';

test.skip(process.env['KALIO_DEVIN_MENU_REPAIR'] !== '1', 'Explicit authorized HomeSite repair only');
test('approve reviewed CSS repair and review build request', async ({ page }) => {
  test.skip(process.env['KALIO_DEVIN_MENU_REPAIR_PHASE'] !== 'css', 'Explicit CSS review phase required');
  test.setTimeout(120000);
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, 'W4fggLSunrJB41C24MV7C', 'New Chat');
  const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
  await expect(confirm).toBeVisible();
  await page.getByRole('button', { name: 'Toggle args', exact: true }).last().click();
  const region = page.getByRole('region', { name: 'Full tool arguments', exact: true }).last();
  await expect(region).toContainText('path: E:/Projekty/home-site/src/styles.css');
  await expect(region).toContainText('.navbar__przelacznik { display: flex; position: relative; z-index: 1; }');
  await confirm.click();
  await expect(confirm).toHaveCount(0);
  await expect(confirm).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: 'Toggle args', exact: true }).last().click();
  const build = page.getByRole('region', { name: 'Full tool arguments', exact: true }).last();
  console.log('QA95_BUILD_ARGS', await build.innerText());
  await page.screenshot({ path: resolve(__dirname, '../../../docs/raports/qa-run-95/assets/build-awaiting-approval.png') });
});
test('approve only the exact HomeSite npm build and wait for completion', async ({ page }) => {
  test.skip(process.env['KALIO_DEVIN_MENU_REPAIR_PHASE'] !== 'build', 'Explicit build review phase required');
  test.setTimeout(120000);
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, 'W4fggLSunrJB41C24MV7C', 'New Chat');
  const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
  await expect(confirm).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: 'Toggle args', exact: true }).last().click();
  const region = page.getByRole('region', { name: 'Full tool arguments', exact: true }).last();
  const args = await region.innerText();
  console.log('QA95_BUILD_ARGS', args);
  expect(args).toMatch(/command: npm\s/);
  expect(args).toMatch(/cwd: E:\/Projekty\/home-site/);
  expect(args).toMatch(/args: \[\s*"run",\s*"build"\s*\]/);
  await page.screenshot({ path: resolve(__dirname, '../../../docs/raports/qa-run-95/assets/build-awaiting-approval.png') });
  await confirm.click();
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0, { timeout: 90000 });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  console.log((await page.locator('body').ariaSnapshot()).slice(-6500));
  await page.screenshot({ path: resolve(__dirname, '../../../docs/raports/qa-run-95/assets/repair-completed.png') });
});
test('ask real Devin to repair the mobile menu and pause for reviewed approval', async ({ page }) => {
  test.skip(process.env['KALIO_DEVIN_MENU_REPAIR_PHASE'] !== 'start', 'Explicit prompt phase required');
  test.setTimeout(120000);
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, 'W4fggLSunrJB41C24MV7C', 'New Chat');
  await expect(page.getByText('Devin CLI · swe-2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  console.log((await page.locator('body').ariaSnapshot()).slice(-1500));
  await page.getByRole('textbox', { name: 'Chat message', exact: true }).fill(
    'QA95 naprawa rzeczywistego błędu HomeSite E:/Projekty/home-site. Model dokładnie swe-2. ' +
    'Audyt Chromium 390x844: po otwarciu menu przycisk Zamknij menu jest widoczny i enabled, ' +
    'ale nav#menu-glowne.navbar__menu--otwarte przechwytuje pointer events; kliknięcie nie działa. Escape działa. ' +
    'Użyj tylko Kalio fs_list/fs_read/fs_write i terminal_spawn/list/output. Najpierw odczytaj aktualny kod. ' +
    'Napraw najmniejszym możliwym patchem stacking/hit testing menu, zachowaj focus trap, Escape, focus return, ' +
    'zamykanie linkiem i reduced-motion. Zmiany wyłącznie w src tego projektu. Każdy fs_write i terminal_spawn ' +
    'wymaga osobnej zgody w Kalio: zaczekaj na nią. Potem npm run build w tym projekcie i rzeczywisty wynik. ' +
    'Nie używaj natywnego filesystem/terminal/web, nie commituj, nie deployuj, nie zatrzymuj preview.'
  );
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: 'Toggle args', exact: true }).last().click();
  const args = page.getByRole('region', { name: 'Full tool arguments', exact: true }).last();
  await expect(args).toContainText('E:/Projekty/home-site');
  console.log('QA95_PENDING_ARGS', await args.innerText());
  await page.screenshot({ path: resolve(__dirname, '../../../docs/raports/qa-run-95/assets/repair-awaiting-approval.png') });
  // Leave the exact request visible for payload review; this test never approves blindly.
});
