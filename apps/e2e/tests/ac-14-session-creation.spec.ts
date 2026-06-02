import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-14: New session can be created and becomes the active session
test.describe('AC-14: Session creation', () => {
  test('clicking new session creates a session and selects it', async ({ page }) => {
    await page.goto('/');

    // Open Talk section (contains Conversations)
    await page.getByTestId('nav-talk').click();

    const newSessionBtn = page.getByTestId('new-session-btn');
    await expect(newSessionBtn).toBeVisible();
    await newSessionBtn.click();

    // Session list should have at least one item after clicking
    await expect(page.getByTestId('session-item').first()).toBeVisible({ timeout: 5000 });
  });

  test('chat input is enabled after session is created', async ({ page }) => {
    await page.goto('/');

    // Open Talk section - chat is visible in split view
    await page.getByTestId('nav-talk').click();
    await page.getByTestId('new-session-btn').click();

    // Chat input should be visible and enabled immediately (split view)
    const chatInput = page.getByTestId('chat-input');
    await expect(chatInput).toBeVisible({ timeout: 5000 });
    await expect(chatInput).toBeEnabled({ timeout: 5000 });
  });

  test('new session is listed in the session panel', async ({ request, page }) => {
    // Create via API
    const res = await request.post(`${API_BASE}/sessions`, { data: { title: 'AC14 Listed Session' } });
    const session = await res.json();

    await page.goto('/');

    // Open Talk section
    await page.getByTestId('nav-talk').click();

    // The session should appear in the conversation list
    await expect(
      page.getByTestId('session-item').filter({ hasText: 'AC14 Listed Session' }).first(),
    ).toBeVisible({ timeout: 5000 });

    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });

  test('Quick Chat send navigates to chat and input is not permanently locked', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('landing-page')).toBeVisible({ timeout: 5000 });

    const quickChatInput = page.getByTestId('quick-chat-input');
    await expect(quickChatInput).toBeVisible();
    await quickChatInput.fill('Hello from Quick Chat');
    await page.getByTestId('quick-chat-send').click();

    // Should navigate to chat interface
    await expect(page.getByTestId('chat-interface')).toBeVisible({ timeout: 10_000 });

    // Input must eventually re-enable (proves isStreaming was reset and error surfaced correctly)
    const chatInput = page.getByTestId('chat-input');
    await expect(chatInput).toBeEnabled({ timeout: 30_000 });
  });
});
