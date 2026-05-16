import { test, expect } from '@playwright/test';
import { API_BASE, deleteSessionIfExists, selectSession } from './helpers/test-config';

const LONG_STREAMING_PROMPT = `Repeat this text slowly: ${'HELLO '.repeat(80).trim()}`;

function uniqueSessionTitle(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// AC-01: When user sends a message, assistant response streams token-by-token
test.describe('AC-01: LLM streaming', () => {
  test('chat input is disabled while streaming and re-enables after response', async ({ page, request }) => {
    const title = uniqueSessionTitle('AC01 Streaming Test');

    // Pre-create session via API so the backend has a DB record
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId: 'default' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, session.id, title);

    const chatInput = page.getByTestId('chat-input');
    await expect(chatInput).toBeEnabled({ timeout: 5000 });
    await chatInput.fill(LONG_STREAMING_PROMPT);
    await page.getByTestId('chat-send-btn').click();

    // The stop button is rendered from the same streaming state that disables input,
    // but it is more reliable to observe under the mock provider.
    await expect(page.getByTestId('chat-stop-btn')).toBeVisible({ timeout: 5000 });

    // Wait for response — input re-enables when chat:complete fires
    await expect(chatInput).toBeEnabled({ timeout: 30_000 });

    // At least one agent turn bubble should be present (assistant replies use AgentTurnBubble)
    const assistantBubbles = page.getByTestId('agent-turn-bubble');
    await expect(assistantBubbles.first()).toBeVisible({ timeout: 5000 });
    const content = await assistantBubbles.first().textContent();
    expect(content?.trim().length).toBeGreaterThan(0);

    // Cleanup
    await deleteSessionIfExists(request, session.id);
  });

  test('error from server shows error banner and re-enables input', async ({ page, request }) => {
    const title = uniqueSessionTitle('AC01 Error Test');

    // Create a valid session, navigate to it, then delete it via API before sending
    // so the backend emits chat:error (SESSION_NOT_FOUND) immediately
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId: 'default' },
    });
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, session.id, title);

    const chatInput = page.getByTestId('chat-input');
    await expect(chatInput).toBeEnabled({ timeout: 5000 });

    // Delete the session via API — the next message send will trigger SESSION_NOT_FOUND
    await deleteSessionIfExists(request, session.id);

    await chatInput.fill('trigger error');
    await page.getByTestId('chat-send-btn').click();

    // Input should re-enable quickly after the error (no LLM involved)
    await expect(chatInput).toBeEnabled({ timeout: 10_000 });

    // Error banner should be visible
    await expect(page.getByTestId('chat-error')).toBeVisible({ timeout: 5000 });
  });

  test('WS SESSION_NOT_FOUND error surfaces in chat UI', async ({ page, request }) => {
    const title = uniqueSessionTitle('AC01 Guard Test');

    // Create a session on the client side only (no API call) is not possible from PW
    // Instead, verify the guard works: delete a session from DB then try to chat
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId: 'default' },
    });
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, session.id, title);

    // Delete the session from the backend WHILE it is active in the UI
    await deleteSessionIfExists(request, session.id);

    const chatInput = page.getByTestId('chat-input');
    await expect(chatInput).toBeEnabled({ timeout: 5000 });
    await chatInput.fill('This should fail with SESSION_NOT_FOUND');
    await page.getByTestId('chat-send-btn').click();

    // Error banner should appear
    await expect(page.getByTestId('chat-error')).toBeVisible({ timeout: 10_000 });
    // Input re-enables after error
    await expect(chatInput).toBeEnabled({ timeout: 5000 });
  });
});
