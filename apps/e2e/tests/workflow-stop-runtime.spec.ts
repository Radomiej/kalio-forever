import { test, expect } from '@playwright/test';
import {
  deleteSessionIfExists,
  expectComposerEnabled,
  selectArchitectureInComposer,
} from './helpers/test-config';

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
      await page.getByTestId('welcome-prompt-input').fill('Oceń architekturę projektu i zatrzymaj po starcie');
      await page.getByTestId('welcome-run-prompt').click();

      createdSessionId = await page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id'));

      await expect(page.getByTestId('architecture-run-timeline')).toBeVisible({ timeout: 20_000 });
      const stopBtn = page.getByTestId('chat-stop-btn');
      await expect(stopBtn).toBeVisible({ timeout: 20_000 });

      await stopBtn.click();

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
