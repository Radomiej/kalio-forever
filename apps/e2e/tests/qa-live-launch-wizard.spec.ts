import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const fixedQa = process.env['KALIO_FIXED_QA_READONLY_AUDIT_URL'];
const reportRun = process.env['KALIO_FIXED_QA_REPORT_RUN'];
test.skip(!fixedQa || !reportRun, 'Requires explicit fixed-QA browser audit and report number.');

test('live compact launch keeps SWE-2 selection, header and unsent prompt consistent', async ({ page }) => {
  if (fixedQa !== 'http://localhost:5288/' || !/^\d+$/.test(reportRun!)) {
    throw new Error('Requires approved fixed local QA and numeric report run');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fixedQa!);
  await page.getByRole('button', { name: 'Talk', exact: true }).click();
  // Reuse the existing empty QA session. Never create, delete or run a chat.
  await page.getByText('New Chat', { exact: true }).first().click();
  await expect(page.getByRole('combobox', { name: 'Provider and model', exact: true })).toBeVisible();

  const configuration = page.getByRole('button', { name: 'Conversation settings', exact: true });
  await expect(page.getByRole('combobox', { name: 'Persona', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Provider and model', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeVisible();
  await expect(configuration).toBeHidden();
  await page.screenshot({ path: resolve(__dirname, `../../../apps/e2e/outputs/qa-run-${reportRun}/assets/launch-desktop-1440.png`), animations: 'disabled' });

  for (const width of [320, 390, 820]) {
    await page.setViewportSize({ width, height: 900 });
    const hideConversations = page.getByRole('button', { name: 'Hide conversations', exact: true });
    if (await hideConversations.isVisible()) await hideConversations.click();
    const model = page.getByRole('combobox', { name: 'Provider and model', exact: true });
    const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
    const draft = `QA${reportRun} unsent compact draft`;
    await expect(prompt).toBeVisible();
    await expect(configuration).toHaveAttribute('aria-expanded', 'false');
    await expect(model).toBeHidden();
    await prompt.fill(draft);
    await configuration.click();
    await model.fill('swe-2');
    await page.getByRole('option', { name: /^Devin CLI · swe-2 Devin · swe-2 Free · Pro\+ · Oct 16(?: Selected)?$/ }).click();
    await expect(page.getByTestId('chat-runtime-label')).toHaveText('Devin CLI · swe-2');
    await expect(page.getByRole('combobox', { name: 'Persona', exact: true })).toHaveText('Default');
    await expect(prompt).toHaveValue(draft);
    await expect(page.getByRole('button', { name: 'Hide conversations', exact: true })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(__dirname, `../../../apps/e2e/outputs/qa-run-${reportRun}/assets/launch-config-${width}.png`), animations: 'disabled' });

    await configuration.click();
    await expect(model).toBeHidden();
    await expect(prompt).toHaveValue(draft);
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
    await page.screenshot({ path: resolve(__dirname, `../../../apps/e2e/outputs/qa-run-${reportRun}/assets/launch-prompt-${width}.png`), animations: 'disabled' });
  }
});
