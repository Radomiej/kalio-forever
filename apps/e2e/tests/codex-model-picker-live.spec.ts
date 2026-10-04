import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test.skip(process.env['KALIO_CODEX_PICKER_QA119'] !== '1', 'Explicit catalog/profile selection only; no generation');
test('discovers and selects exact Codex account model without sending a prompt', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await expect(page.getByTestId('welcome-prompt-input')).toBeVisible();
  console.log((await page.locator('body').ariaSnapshot()).slice(-2200));
  await page.getByRole('button', { name: 'Recheck Codex models', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recheck Codex models', exact: true })).toBeEnabled();
  const input = page.getByRole('combobox', { name: 'Provider and model', exact: true });
  await input.fill('Codex · gpt-');
  await expect(page.getByRole('option', { name: /^Codex · gpt-6-luna/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /^Codex · gpt-5\.4/ })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /^Codex · gpt-5\.3/ })).toHaveCount(0);
  await page.screenshot({ path: resolve(__dirname, '../../../docs/raports/qa-run-119/assets/codex-catalog.png') });
  const request = page.waitForRequest(r => r.url().endsWith('/api/runtime/profiles/codex/resolve') && r.method() === 'POST');
  const response = page.waitForResponse(r => r.url().endsWith('/api/runtime/profiles/codex/resolve') && r.request().method() === 'POST');
  await page.getByRole('option', { name: /^Codex · gpt-6-luna/ }).click();
  expect((await request).postDataJSON()).toEqual({ authProfileId: 'chatgpt-default', model: 'gpt-6-luna' });
  const resolved = await response;
  expect(resolved.ok()).toBe(true);
  expect(await resolved.json()).toMatchObject({ kind: 'codex-app-server', authProfileId: 'chatgpt-default', model: 'gpt-6-luna', approvalMode: 'kalio_strict' });
  await expect(input).toHaveValue('Codex · gpt-6-luna');
  await expect(page.getByTestId('welcome-prompt-input')).toHaveValue('');
  await page.screenshot({ path: resolve(__dirname, '../../../docs/raports/qa-run-119/assets/codex-selected.png') });
});
