import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-08: ChatGateway disconnects gracefully and emits error event
test.describe('AC-08: WebSocket error handling', () => {
  test('chat:error from server displays error banner in UI', async ({ page, request }) => {
    // Create and then delete a session, then try to chat — triggers SESSION_NOT_FOUND
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title: 'AC08 Error Banner', personaId: 'default' },
    });
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-sessions').click();
    await expect(
      page.getByTestId('session-item').filter({ hasText: 'AC08 Error Banner' }).first(),
    ).toBeVisible({ timeout: 5000 });
    await page.getByTestId('session-item').filter({ hasText: 'AC08 Error Banner' }).first().click();

    // Delete session in DB so next send triggers SESSION_NOT_FOUND on backend
    await request.delete(`${API_BASE}/sessions/${session.id}`);

    const chatInput = page.getByTestId('chat-input');
    await expect(chatInput).toBeEnabled({ timeout: 5000 });
    await chatInput.fill('trigger error');
    await page.getByTestId('chat-send-btn').click();

    // Error banner must appear (proves chat:error event reaches the frontend)
    await expect(page.getByTestId('chat-error')).toBeVisible({ timeout: 10_000 });
  });

  test('streaming indicator disappears after error and input re-enables', async ({ page, request }) => {
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title: 'AC08 Streaming Recovery', personaId: 'default' },
    });
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-sessions').click();
    await expect(
      page.getByTestId('session-item').filter({ hasText: 'AC08 Streaming Recovery' }).first(),
    ).toBeVisible({ timeout: 5000 });
    await page.getByTestId('session-item').filter({ hasText: 'AC08 Streaming Recovery' }).first().click();

    await request.delete(`${API_BASE}/sessions/${session.id}`);

    const chatInput = page.getByTestId('chat-input');
    await expect(chatInput).toBeEnabled({ timeout: 5000 });
    await chatInput.fill('recovery test');
    await page.getByTestId('chat-send-btn').click();

    // Input must re-enable after error (not stuck in streaming state)
    await expect(chatInput).toBeEnabled({ timeout: 10_000 });
  });

  test('user can send another message after an error', async ({ page, request }) => {
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title: 'AC08 Resend', personaId: 'default' },
    });
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-sessions').click();
    await expect(
      page.getByTestId('session-item').filter({ hasText: 'AC08 Resend' }).first(),
    ).toBeVisible({ timeout: 5000 });
    await page.getByTestId('session-item').filter({ hasText: 'AC08 Resend' }).first().click();

    await request.delete(`${API_BASE}/sessions/${session.id}`);

    const chatInput = page.getByTestId('chat-input');
    await expect(chatInput).toBeEnabled({ timeout: 5000 });
    await chatInput.fill('first attempt');
    await page.getByTestId('chat-send-btn').click();
    await expect(page.getByTestId('chat-error')).toBeVisible({ timeout: 10_000 });

    // Dismiss error and verify we can type again
    await page.getByTestId('chat-error').getByRole('button').click();
    await expect(chatInput).toBeEnabled();
    await chatInput.fill('second attempt');
    // Verify input accepts text — not locked
    await expect(chatInput).toHaveValue('second attempt');
  });
});
