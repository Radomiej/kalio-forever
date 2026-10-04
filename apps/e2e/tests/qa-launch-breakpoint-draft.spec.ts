import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { API_BASE } from './helpers/test-config';

const reportRun = process.env['KALIO_LAUNCH_BREAKPOINT_REPORT_RUN'] ?? '154';
if (!/^[1-9]\d*$/.test(reportRun)) throw new Error('Numeric report run required');
test.skip(process.env['KALIO_LAUNCH_BREAKPOINT_AUDIT'] !== '1', 'Explicit fixed QA draft-only audit');
test('new chat preserves SWE-2 selection and draft across the desktop wizard boundary', async ({ page, request }) => {
  const sessionWrites: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && /\/api\/sessions(?:\?|$)/.test(request.url())) sessionWrites.push(request.url());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  const creation = page.waitForResponse(response => response.request().method() === 'POST' && /\/api\/sessions(?:\?|$)/.test(response.url()));
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const createdResponse = await creation;
  expect(createdResponse.ok()).toBe(true);
  const created = await createdResponse.json() as { id: string };
  expect(created.id).toMatch(/^[\w-]+$/);
  console.info(`QA${reportRun} owned draft session: ${created.id}`);
  try {
  const model = page.getByRole('combobox', { name: 'Provider and model', exact: true });
  const persona = page.getByRole('combobox', { name: 'Persona', exact: true });
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  const next = page.getByRole('button', { name: 'Next — write prompt', exact: true });
  const back = page.getByRole('button', { name: 'Back — configuration', exact: true });
  await expect(model).toBeVisible();
  await model.fill('swe-2');
  const option = page.getByRole('option', { name: /^Devin CLI · swe-2 Devin · swe-2 Free · Pro\+ · Oct 16(?: Selected)?$/ });
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.getByTestId('chat-runtime-label')).toHaveText('Devin CLI · swe-2');
  await expect(page.getByTestId('selected-model-cost-note')).toContainText('SWE-2 is free in Devin Desktop and CLI on Pro or higher through October 16, 2026.');
  const draft = `QA${reportRun} draft only — do not send`;
  await prompt.fill(draft);
  for (const width of [1440, 1024, 1023, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width >= 1024) {
      await expect(persona).toBeVisible();
      await expect(model).toHaveValue('Devin CLI · swe-2');
      await expect(prompt).toHaveValue(draft);
      await expect(next).not.toBeVisible();
      await expect(back).not.toBeVisible();
    } else {
      if (await back.isVisible()) await back.click();
      await expect(persona).toBeVisible();
      await expect(model).toHaveValue('Devin CLI · swe-2');
      await expect(prompt).toHaveCount(0);
      await expect(next).toBeVisible();
      await next.click();
      await expect(model).toHaveCount(0);
      await expect(prompt).toHaveValue(draft);
      await expect(back).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/launch-${width}.png`), animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(persona).toBeVisible();
  await expect(model).toHaveValue('Devin CLI · swe-2');
  await expect(prompt).toHaveValue(draft);
  await expect(next).not.toBeVisible();
  await expect(back).not.toBeVisible();
  expect(sessionWrites).toHaveLength(1);
  } finally {
    const messages = await request.get(`${API_BASE}/sessions/${created.id}/messages`);
    expect(messages.ok()).toBe(true);
    expect(await messages.json(), 'Never delete a session that gained real messages').toEqual([]);
    const current = await request.get(`${API_BASE}/sessions/${created.id}/runs/current`);
    expect(current.ok()).toBe(true);
    expect(await current.text(), 'Never delete an active draft').toBe('');
    const children = await request.get(`${API_BASE}/sessions/${created.id}/children`);
    expect(children.ok()).toBe(true);
    expect(await children.json(), 'Never delete a session with child executions').toEqual([]);
    if (process.env['KALIO_LAUNCH_PRESERVE_DRAFT'] === '1') {
      console.info(`QA${reportRun} preserved empty draft: ${created.id}`);
    } else {
      expect((await request.delete(`${API_BASE}/sessions/${created.id}`)).ok()).toBe(true);
    }
  }
});
