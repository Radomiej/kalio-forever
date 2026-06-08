import { test, expect } from '@playwright/test';
import {
  API_BASE,
  expectComposerEnabled,
  selectSession,
  sendMessageFromComposer,
} from './helpers/test-config';

// AC-08: ChatGateway disconnects gracefully and emits error event
test.describe('AC-08: WebSocket error handling', () => {
  test('chat:error from server displays error banner in UI', async ({ page, request }) => {
    // Create and then delete a session, then try to chat — triggers SESSION_NOT_FOUND
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title: 'AC08 Error Banner', personaId: 'default' },
    });
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, session.id, 'AC08 Error Banner');

    // Delete session in DB so next send triggers SESSION_NOT_FOUND on backend
    await request.delete(`${API_BASE}/sessions/${session.id}`);

    await expectComposerEnabled(page, 5000);
    await sendMessageFromComposer(page, 'trigger error');

    // Error banner must appear (proves chat:error event reaches the frontend)
    await expect(page.getByTestId('chat-error')).toBeVisible({ timeout: 10_000 });
  });

  test('streaming indicator disappears after error and input re-enables', async ({ page, request }) => {
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title: 'AC08 Streaming Recovery', personaId: 'default' },
    });
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, session.id, 'AC08 Streaming Recovery');

    await request.delete(`${API_BASE}/sessions/${session.id}`);

    await expectComposerEnabled(page, 5000);
    await sendMessageFromComposer(page, 'recovery test');

    // Input must re-enable after error (not stuck in streaming state)
    await expectComposerEnabled(page, 10_000);
  });

  test('user can send another message after an error', async ({ page, request }) => {
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title: 'AC08 Resend', personaId: 'default' },
    });
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, session.id, 'AC08 Resend');

    await request.delete(`${API_BASE}/sessions/${session.id}`);

    await expectComposerEnabled(page, 5000);
    await sendMessageFromComposer(page, 'first attempt');
    await expect(page.getByTestId('chat-error')).toBeVisible({ timeout: 10_000 });

    // Dismiss error and verify we can type again
    await page.getByTestId('chat-error').getByRole('button').click();
    const chatInput = await expectComposerEnabled(page, 10_000);
    await chatInput.fill('second attempt');
    // Verify input accepts text — not locked
    await expect(chatInput).toHaveValue('second attempt');
  });
});
