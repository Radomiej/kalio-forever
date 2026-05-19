import { expect, test } from '@playwright/test';
import { API_BASE, deleteSessionIfExists, selectSession } from './helpers/test-config';

// AC-02: When a tool with requiresConfirmation=true is called, user sees HITL dialog before execution
test.describe('AC-02: HITL tool confirmation', () => {
  test('REGRESSION: replayed stale confirmation is invalidated after a stale confirm click', async ({ page, request }) => {
    const suffix = Date.now();
    const title = `AC02 Stale Replay ${suffix}`;
    const requestId = `req-ac02-stale-${suffix}`;
    const toolCallId = `call-ac02-stale-${suffix}`;

    const sessionResponse = await request.post(`${API_BASE}/sessions`, {
      data: {
        personaId: 'default',
        title,
      },
    });
    expect(sessionResponse.ok()).toBeTruthy();
    const session = await sessionResponse.json() as { id: string };

    try {
      const seedResponse = await request.post(`${API_BASE}/test-support/tool-confirmations/seed-replay`, {
        data: {
          sessionId: session.id,
          requestId,
          toolCallId,
          toolName: 'image_generate',
          args: {
            prompt: 'Generate a coffee poster',
          },
          promptMessage: 'Please generate a coffee poster.',
          assistantMessage: 'I need confirmation before running image generation.',
        },
      });
      expect(seedResponse.ok()).toBeTruthy();

      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);

      const confirmButton = page.getByTestId('confirmation-confirm-btn');
      await expect(confirmButton).toBeVisible({ timeout: 10000 });

      const dropResponse = await request.post(`${API_BASE}/test-support/tool-confirmations/drop`, {
        data: {
          requestId,
          sessionId: session.id,
        },
      });
      expect(dropResponse.ok()).toBeTruthy();

      await confirmButton.click();

      await expect(page.getByTestId('confirmation-confirm-btn')).toHaveCount(0);
      await expect(page.getByText('confirmation expired')).toBeVisible();
    } finally {
      await deleteSessionIfExists(request, session.id);
    }
  });
  test.skip('confirming tool proceeds with execution and shows result', () => {});
  test.skip('cancelling tool shows cancellation message and does not execute', () => {});
  test.skip('HITL dialog shows tool name and arguments', () => {});
});
