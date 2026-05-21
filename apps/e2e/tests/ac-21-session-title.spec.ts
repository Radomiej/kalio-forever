import { test, expect } from '@playwright/test';
import { API_BASE, deleteSessionIfExists } from './helpers/test-config';

const LAST_ACTIVE_SESSION_STORAGE_KEY = 'kalio:last-active-session-id';

function buildGeneratedTitle(content: string): string {
  const preview = content.slice(0, 60).trim();
  return preview + (content.length > 60 ? '…' : '');
}

// AC-21: Session generate-title endpoint
test.describe('AC-21: Session auto-title', () => {
  test('POST /sessions/:id/generate-title returns title for session with messages', async ({ request }) => {
    // Create session
    const sessionRes = await request.post(`${API_BASE}/sessions`, {
      data: { personaId: 'default' },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();

    // For a session with no messages it should return a fallback
    const titleRes = await request.post(`${API_BASE}/sessions/${session.id}/generate-title`);
    expect(titleRes.ok()).toBeTruthy();
    const { title } = await titleRes.json();
    expect(typeof title).toBe('string');
    expect(title.length).toBeGreaterThan(0);

    // Cleanup
    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });

  test('sidebar title upgrades from New Chat to the generated final title after first reply', async ({ page, request }) => {
    test.setTimeout(45_000);

    const prompt = 'Session title regression verification uses a deliberately long first prompt to exceed sixty characters. Reply with exactly OK and do not use tools.';
    const generatedTitle = buildGeneratedTitle(prompt);
    let sessionId: string | null = null;

    try {
      await page.goto('/');
      await page.getByTestId('nav-talk').click();

      const newSessionButton = page.getByTestId('new-session-btn');
      await expect(newSessionButton).toBeVisible({ timeout: 5000 });
      await newSessionButton.click();

      const activeSessionTitle = page.getByTestId('session-item').first().locator('span').first();
      await expect(activeSessionTitle).toHaveText('New Chat', { timeout: 5000 });

      await expect
        .poll(
          () => page.evaluate((storageKey) => window.sessionStorage.getItem(storageKey), LAST_ACTIVE_SESSION_STORAGE_KEY),
          { timeout: 5000 },
        )
        .not.toBeNull();
      sessionId = await page.evaluate((storageKey) => window.sessionStorage.getItem(storageKey), LAST_ACTIVE_SESSION_STORAGE_KEY);

      const chatInput = page.getByTestId('chat-input');
      await expect(chatInput).toBeEnabled({ timeout: 5000 });
      await chatInput.fill(prompt);
      await page.getByTestId('chat-send-btn').click();

      await expect
        .poll(
          async () => {
            const title = (await activeSessionTitle.textContent())?.trim();
            return Boolean(title && title !== 'New Chat');
          },
          { timeout: 10_000 },
        )
        .toBe(true);

      await expect(chatInput).toBeEnabled({ timeout: 30_000 });
      await expect(activeSessionTitle).toHaveText(generatedTitle, { timeout: 10_000 });
    } finally {
      if (sessionId) {
        await deleteSessionIfExists(request, sessionId);
      }
    }
  });
});
