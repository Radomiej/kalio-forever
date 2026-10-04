import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { API_BASE, deleteSessionIfExists, selectSession } from './helpers/test-config';

test('long confirmation payload remains fully reviewable on mobile and tablet after reload', async ({ page, request }, testInfo) => {
  const reportRun = process.env['KALIO_FULL_ARGS_REPORT_RUN'];
  if (reportRun !== undefined && !/^[1-9]\d*$/.test(reportRun)) throw new Error('Numeric report run required');
  const suffix = Date.now();
  const title = `Full arguments fixture ${suffix}`;
  const response = await request.post(`${API_BASE}/sessions`, {
    data: { personaId: 'default', title },
  });
  expect(response.ok()).toBeTruthy();
  const session = await response.json() as { id: string };
  const requestId = `full-args-request-${suffix}`;
  const payload = '/* REVIEW START */\n' + 'x'.repeat(2000) + '\n/* REVIEW END */';
  try {
    const seeded = await request.post(`${API_BASE}/test-support/tool-confirmations/seed-replay`, {
      data: {
        sessionId: session.id, requestId, toolCallId: `full-args-call-${suffix}`,
        toolName: 'fs_write', args: { path: 'fixture-only.css', content: payload },
        promptMessage: 'Review this fixture without executing it.',
        assistantMessage: 'Waiting for review of the full file contents.',
      },
    });
    expect(seeded.ok()).toBeTruthy();
    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, session.id, title);
    for (const width of [320, 390, 820]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await expect(page.getByTestId('confirmation-confirm-btn')).toBeVisible();
      const panel = page.getByRole('region', { name: 'Full tool arguments' });
      await expect(panel).toBeVisible();
      await expect(panel).toContainText(payload);
      await page.getByTestId('confirmation-args-toggle').click();
      await expect(panel).toHaveCount(0);
      await expect(page.getByTestId('args-preview')).toBeVisible();
      await expect(page.getByTestId('args-preview')).not.toContainText('REVIEW END');
      await page.getByTestId('confirmation-args-toggle').click();
      await expect(panel).toBeVisible();
      await expect(panel).toContainText(payload);
      await expect(panel).toHaveAttribute('tabindex', '0');
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await panel.focus();
      await panel.press('Control+End');
      await expect.poll(() => panel.evaluate((element) => element.scrollTop > 0)).toBe(true);
      await page.screenshot({
        path: reportRun
          ? resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/full-arguments-fixture-${width}.png`)
          : testInfo.outputPath(`full-arguments-fixture-${width}.png`),
      });
    }
  } finally {
    const dropped = await request.post(`${API_BASE}/test-support/tool-confirmations/drop`, {
      data: { requestId, sessionId: session.id },
    });
    expect(dropped.ok()).toBeTruthy();
    await deleteSessionIfExists(request, session.id);
  }
});
