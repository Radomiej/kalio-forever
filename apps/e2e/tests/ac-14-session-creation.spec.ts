import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-14: New session can be created and becomes the active session
test.describe('AC-14: Session creation', () => {
  test('clicking new session creates a session and selects it', async ({ page }) => {
    await page.goto('http://localhost:5188');

    // Open the sessions sidebar first
    await page.getByTestId('nav-sessions').click();

    const newSessionBtn = page.getByTestId('new-session-btn');
    await expect(newSessionBtn).toBeVisible();
    await newSessionBtn.click();

    // Session list should have at least one item after clicking
    await expect(page.getByTestId('session-item').first()).toBeVisible({ timeout: 5000 });
  });

  test('chat input is enabled after session is created', async ({ page }) => {
    await page.goto('http://localhost:5188');

    // Open the sessions sidebar first
    await page.getByTestId('nav-sessions').click();
    await page.getByTestId('new-session-btn').click();

    // Chat input should be visible and enabled
    const chatInput = page.getByTestId('chat-input');
    await expect(chatInput).toBeVisible({ timeout: 5000 });
    await expect(chatInput).toBeEnabled();
  });

  test('new session is listed in the session panel', async ({ request, page }) => {
    // Create via API
    const res = await request.post(`${API_BASE}/sessions`, { data: { title: 'AC14 Listed Session' } });
    const session = await res.json();

    await page.goto('http://localhost:5188');

    // Open sessions sidebar
    await page.getByTestId('nav-sessions').click();

    // The session should appear in the sidebar session list
    await expect(
      page.getByTestId('session-item').filter({ hasText: 'AC14 Listed Session' }).first(),
    ).toBeVisible({ timeout: 5000 });

    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });
});
