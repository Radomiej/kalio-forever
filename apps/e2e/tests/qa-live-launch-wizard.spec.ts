import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const fixedQa = process.env['KALIO_FIXED_QA_READONLY_AUDIT_URL'];
const reportRun = process.env['KALIO_FIXED_QA_REPORT_RUN'];
test.skip(!fixedQa || !reportRun, 'Requires explicit fixed-QA browser audit and report number.');

test('live launch wizard keeps SWE-2 selection, header and unsent prompt consistent', async ({ page }) => {
  if (fixedQa !== 'http://localhost:5288/' || !/^\d+$/.test(reportRun!)) {
    throw new Error('Requires approved fixed local QA and numeric report run');
  }
  await page.goto(fixedQa!);
  await page.getByRole('button', { name: 'Talk', exact: true }).click();
  // Reuse the existing empty QA session. Never create, delete or run a chat.
  await page.getByText('New Chat', { exact: true }).first().click();
  await expect(page.getByRole('combobox', { name: 'Provider and model', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('combobox', { name: 'Persona', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Provider and model', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next — write prompt', exact: true })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Back — configuration', exact: true })).not.toBeVisible();
  await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/launch-desktop-1440.png`), animations: 'disabled' });

  for (const width of [320, 390, 820]) {
    await page.setViewportSize({ width, height: 900 });
    const hideConversations = page.getByRole('button', { name: 'Hide conversations', exact: true });
    if (await hideConversations.isVisible()) await hideConversations.click();
    const model = page.getByRole('combobox', { name: 'Provider and model', exact: true });
    await model.fill('swe-2');
    await page.getByRole('option', { name: /^Devin CLI · swe-2 Devin · swe-2 Free · Pro\+ · Oct 16(?: Selected)?$/ }).click();
    await expect(page.getByTestId('chat-runtime-label')).toHaveText('Devin CLI · swe-2');
    await expect(page.getByRole('combobox', { name: 'Persona', exact: true })).toHaveText('Default');
    await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Hide conversations', exact: true })).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/launch-config-${width}.png`), animations: 'disabled' });

    await page.getByRole('button', { name: 'Next — write prompt', exact: true }).click();
    const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
    await prompt.fill(`QA${reportRun} unsent wizard draft`);
    await expect(model).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Back — configuration', exact: true }).click();
    await expect(model).toHaveValue('Devin CLI · swe-2');
    await page.getByRole('button', { name: 'Next — write prompt', exact: true }).click();
    await expect(prompt).toHaveValue(`QA${reportRun} unsent wizard draft`);
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/launch-prompt-${width}.png`), animations: 'disabled' });
    await page.getByRole('button', { name: 'Back — configuration', exact: true }).click();
  }
});
