import { expect, test } from '@playwright/test';
import {
  deleteSessionIfExists,
  selectArchitectureInComposer,
  sendMessageFromComposer,
} from './helpers/test-config';

test.describe('Workflow architecture label proof', () => {
  test('shows the workflow label in chat header and the conversation sidebar', async ({ page, request }, testInfo) => {
    test.setTimeout(90_000);

    let sessionId: string | null = null;

    try {
      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await page.getByTestId('new-session-btn').click();

      await expect
        .poll(
          () => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')),
          { timeout: 10_000 },
        )
        .not.toBeNull();
      sessionId = await page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id'));
      if (!sessionId) {
        throw new Error('Missing active session id after creating a Talk conversation');
      }

      await selectArchitectureInComposer(page, 'strategic-decision-council');
      await sendMessageFromComposer(page, 'Assess the release workflow and answer briefly.');

      await expect(page.getByTestId('chat-session-architecture-label')).toHaveText('Strategic Decision Council', { timeout: 15_000 });
      await expect(page.getByTestId(`session-architecture-label-${sessionId}`)).toHaveText('Strategic Decision Council', { timeout: 15_000 });

      const activeSessionTitle = page.getByTestId(`session-title-${sessionId}`);
      await expect
        .poll(
          async () => {
            const title = (await activeSessionTitle.textContent())?.trim();
            return title && title !== 'New Chat' ? title : null;
          },
          { timeout: 30_000 },
        )
        .not.toBeNull();
      const finalTitle = ((await activeSessionTitle.textContent()) ?? '').trim();
      await expect(page.getByTestId('chat-session-title')).toHaveText(finalTitle, { timeout: 10_000 });

      const screenshotPath = testInfo.outputPath('workflow-architecture-label-proof.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } finally {
      if (sessionId) {
        await deleteSessionIfExists(request, sessionId);
      }
    }
  });
});
