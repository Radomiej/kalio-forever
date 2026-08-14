import { test, expect, type Page } from '@playwright/test';
import {
  deleteSessionIfExists,
  expectComposerEnabled,
  selectArchitectureInComposer,
} from './helpers/test-config';

const STOPPABLE_WORKFLOW_PROMPT = [
  'Evaluate the project architecture and keep the workflow running long enough for a stop request.',
  '[[mock:script]]',
  'hold(8000) return("controlled workflow stop target finished")',
  '[[/mock:script]]',
].join('\n');

async function clickStopButton(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const stopBtn = page.getByTestId('chat-stop-btn');
      if (!await stopBtn.isVisible().catch(() => false)) {
        return 'missing';
      }
      try {
        await stopBtn.click({ force: true, timeout: 1_000 });
        return 'clicked';
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/detached|not attached|Timeout .*chat-stop-btn|waiting for getByTestId\('chat-stop-btn'\)/i.test(message)) {
          return 'retry';
        }
        throw error;
      }
    }, { timeout: 20_000 })
    .toBe('clicked');
}

test.describe('workflow stop on built QA', () => {
  test('workflow stop clears the stop action after a workflow launch', async ({ page, request }) => {
    test.setTimeout(60_000);

    let createdSessionId: string | null = null;

    try {
      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await page.getByTestId('new-session-btn').click();
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 });

      await selectArchitectureInComposer(page, 'strategic-decision-council');
      await page.getByTestId('welcome-prompt-input').fill(STOPPABLE_WORKFLOW_PROMPT);
      await page.getByTestId('welcome-run-prompt').click();

      createdSessionId = await page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id'));

      await expect(page.getByTestId('architecture-run-timeline')).toBeVisible({ timeout: 20_000 });
      const stopBtn = page.getByTestId('chat-stop-btn');
      await expect(stopBtn).toBeVisible({ timeout: 20_000 });

      await clickStopButton(page);

      await expect(stopBtn).toBeHidden({ timeout: 20_000 });
      await expectComposerEnabled(page, 20_000);
      await expect(page.getByTestId('chat-queued-badge')).toHaveCount(0);
      await expect(page.getByTestId('pending-agent-bubble')).toHaveCount(0);
    } finally {
      if (createdSessionId) {
        await deleteSessionIfExists(request, createdSessionId);
      }
    }
  });
});
