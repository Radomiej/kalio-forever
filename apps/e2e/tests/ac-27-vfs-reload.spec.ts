import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-27: VFS files are visible after page reload without manually clicking a session
// Root cause being tested: activeSessionId is not persisted across reloads.
// After a reload the most-recent session must be auto-selected so that
// ConversationFilesBar mounts and fetches VFS files.
test.describe('AC-27: VFS restore after page reload', () => {
  let sessionId: string;

  test.afterEach(async ({ request }) => {
    if (sessionId) {
      await request.delete(`${API_BASE}/sessions/${sessionId}`);
      sessionId = '';
    }
  });

  test('VFS file count is visible without clicking a session on first load', async ({ page, request }) => {
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

    // Navigate to the app — do NOT manually click the session
    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    // The most-recent session should be auto-selected and ConversationFilesBar should show 1 file
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

    // First visit — auto-select should kick in
    await page.goto('/');
    await page.getByTestId('nav-talk').click();

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

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

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

