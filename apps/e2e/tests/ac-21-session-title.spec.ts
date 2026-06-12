import { test, expect } from '@playwright/test';
import { API_BASE, deleteSessionIfExists, sendMessageFromComposer } from './helpers/test-config';

const LAST_ACTIVE_SESSION_STORAGE_KEY = 'kalio:last-active-session-id';

// AC-21: Session generate-title endpoint
test.describe('AC-21: Session auto-title', () => {
  test('POST /sessions/:id/generate-title returns title for session with messages', async ({ request }) => {
    const sessionRes = await request.post(`${API_BASE}/sessions`, {
      data: { personaId: 'default' },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();

    const titleRes = await request.post(`${API_BASE}/sessions/${session.id}/generate-title`);
    expect(titleRes.ok()).toBeTruthy();
    const { title } = await titleRes.json();
    expect(typeof title).toBe('string');
    expect(title.length).toBeGreaterThan(0);
    expect(title.length).toBeLessThanOrEqual(60);

    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });

  test('sidebar title upgrades from New Chat to a summarized title after first reply', async ({ page, request }, testInfo) => {
    test.setTimeout(45_000);

    const prompt = 'Session title regression verification uses a deliberately long first prompt to exceed sixty characters. Reply with exactly OK and do not use tools.';
    let sessionId: string | null = null;

    try {
      await page.goto('/');
      await page.getByTestId('nav-talk').click();

      const newSessionButton = page.getByTestId('new-session-btn');
      await expect(newSessionButton).toBeVisible({ timeout: 5000 });
      await newSessionButton.click();

      await expect
        .poll(
          () => page.evaluate((storageKey) => window.sessionStorage.getItem(storageKey), LAST_ACTIVE_SESSION_STORAGE_KEY),
          { timeout: 5000 },
        )
        .not.toBeNull();
      sessionId = await page.evaluate((storageKey) => window.sessionStorage.getItem(storageKey), LAST_ACTIVE_SESSION_STORAGE_KEY);
      const activeSessionItem = page.locator(`[data-testid="session-item"][data-session-id="${sessionId}"]`);
      const activeSessionTitle = page.getByTestId(`session-title-${sessionId}`);
      await expect(activeSessionTitle).toHaveText('New Chat', { timeout: 5000 });

      await sendMessageFromComposer(page, prompt);

      await expect
        .poll(
          async () => {
            const title = (await activeSessionTitle.textContent())?.trim();
            return title && title !== 'New Chat' ? title : null;
          },
          { timeout: 10_000 },
        )
        .not.toBeNull();

      const finalTitle = ((await activeSessionTitle.textContent()) ?? '').trim();
      expect(finalTitle.length).toBeGreaterThan(0);
      expect(finalTitle.length).toBeLessThanOrEqual(60);
      expect(finalTitle).not.toBe(prompt);
      expect(finalTitle).not.toContain('Reply with exactly OK');
      await expect(page.getByTestId('chat-session-title')).toHaveText(finalTitle, { timeout: 10_000 });

      const screenshotPath = testInfo.outputPath('session-title-summary-proof.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } finally {
      if (sessionId) {
        await deleteSessionIfExists(request, sessionId);
      }
    }
  });
});
