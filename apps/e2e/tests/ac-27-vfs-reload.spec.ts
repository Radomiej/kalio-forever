import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

const LAST_ACTIVE_SESSION_STORAGE_KEY = 'kalio:last-active-session-id';

async function openTalkWithRestoredSession(page: import('@playwright/test').Page, activeSessionId: string) {
  await page.goto('/');
  await expect(page.getByTestId('nav-talk')).toBeVisible({ timeout: 8000 });
  await page.evaluate(([storageKey, sessionId]) => {
    window.sessionStorage.setItem(storageKey, sessionId);
  }, [LAST_ACTIVE_SESSION_STORAGE_KEY, activeSessionId]);
  await page.reload();
  await expect(page.getByTestId('nav-talk')).toBeVisible({ timeout: 8000 });
  await page.getByTestId('nav-talk').click();
}

// AC-27: VFS files are visible after page reload without manually clicking a session
// Root cause being tested: activeSessionId is not persisted across reloads.
// In full-suite runs the backend session list is shared across workers, so the
// E2E oracle restores a specific session via sessionStorage rather than relying
// on global recency. This still exercises the no-manual-click restore path.
test.describe('AC-27: VFS restore after page reload', () => {
  let sessionId: string;

  test.afterEach(async ({ request }) => {
    if (sessionId) {
      await request.delete(`${API_BASE}/sessions/${sessionId}`);
      sessionId = '';
    }
  });

  test('VFS file count is visible when the last active session is restored on first load', async ({ page, request }) => {
    // Create a session via API
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title: 'AC27 VFS Reload Test', personaId: 'default' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json() as { id: string };
    sessionId = session.id;

    // Write a VFS file via API
    const writeRes = await request.post(`${API_BASE}/sessions/${sessionId}/vfs`, {
      data: { filePath: 'ac27-test.txt', content: 'hello from ac27' },
    });
    expect(writeRes.ok()).toBeTruthy();

    await openTalkWithRestoredSession(page, sessionId);

    // The restored session should auto-select and ConversationFilesBar should show 1 file
    const filesBtn = page.getByTestId('conversation-files-toggle');
    await expect(filesBtn).toBeVisible({ timeout: 8000 });
    await expect(filesBtn.locator('.badge')).toHaveText('1', { timeout: 8000 });
  });

  test('VFS file count is restored after page reload without re-clicking the session', async ({ page, request }) => {
    // Create session and write a VFS file
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title: 'AC27 VFS Reload Test', personaId: 'default' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json() as { id: string };
    sessionId = session.id;

    await request.post(`${API_BASE}/sessions/${sessionId}/vfs`, {
      data: { filePath: 'ac27-reload.txt', content: 'reload test' },
    });

    await openTalkWithRestoredSession(page, sessionId);

    const filesBtn = page.getByTestId('conversation-files-toggle');
    await expect(filesBtn.locator('.badge')).toHaveText('1', { timeout: 8000 });

    // Reload the page — still no manual session click
    await page.reload();
    await page.getByTestId('nav-talk').click();

    // After reload, auto-select must fire again → VFS badge still shows 1
    const filesBtnAfter = page.getByTestId('conversation-files-toggle');
    await expect(filesBtnAfter).toBeVisible({ timeout: 8000 });
    await expect(filesBtnAfter.locator('.badge')).toHaveText('1', { timeout: 8000 });
  });

  test('VFS files are listed in the Files modal after reload without manual session click', async ({ page, request }) => {
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title: 'AC27 VFS Modal Test', personaId: 'default' },
    });
    const session = await res.json() as { id: string };
    sessionId = session.id;

    await request.post(`${API_BASE}/sessions/${sessionId}/vfs`, {
      data: { filePath: 'ac27-modal.txt', content: '# Modal test' },
    });

    await openTalkWithRestoredSession(page, sessionId);

    // Wait for auto-selection then open the Files modal
    const filesBtn = page.getByTestId('conversation-files-toggle');
    await expect(filesBtn.locator('.badge')).toHaveText('1', { timeout: 8000 });

    await page.reload();
    await page.getByTestId('nav-talk').click();

    const filesBtnAfterReload = page.getByTestId('conversation-files-toggle');
    await expect(filesBtnAfterReload.locator('.badge')).toHaveText('1', { timeout: 8000 });

    // Open the modal and verify at least one file entry is shown
    await filesBtnAfterReload.click();
    await expect(page.locator('[data-testid="conversation-files-modal"][open]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid^="conv-file-"]').first()).toBeVisible({ timeout: 5000 });
  });
});

