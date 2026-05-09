import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-10: RA-Apps load on landing page and tile-click navigates to chat
test.describe('AC-10: RA-App rendering', () => {
  test('GET /api/ra-apps returns QA and Calculator apps', async ({ request }) => {
    const res = await request.get(`${API_BASE}/ra-apps`);
    expect(res.ok()).toBeTruthy();
    const apps = await res.json() as Array<{ id: string; name: string }>;
    expect(Array.isArray(apps)).toBe(true);
    const ids = apps.map((a) => a.id);
    expect(ids).toContain('qa-interactive');
    expect(ids).toContain('visual-calculator');
  });

  test('RA-App tiles appear on landing page', async ({ page }) => {
    await page.goto('/');
    // The landing page fetches /api/ra-apps; wait for at least one tile
    await expect(page.getByTestId('landing-page')).toBeVisible({ timeout: 5000 });
    // AppTile components rendered by the landing grid
    const tiles = page.getByTestId(/^app-tile-/);
    await expect(tiles.first()).toBeVisible({ timeout: 10_000 });
  });

  test('clicking an RA-App tile navigates to chat interface', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('landing-page')).toBeVisible({ timeout: 5000 });
    const firstTile = page.getByTestId(/^app-tile-/).first();
    await expect(firstTile).toBeVisible({ timeout: 10_000 });
    await firstTile.click();

    // After click, ChatInterface should become visible
    await expect(page.getByTestId('chat-interface')).toBeVisible({ timeout: 10_000 });
  });

  test('chat input is enabled after RA-App tile click (no streaming bleed)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('landing-page')).toBeVisible({ timeout: 5000 });
    const firstTile = page.getByTestId(/^app-tile-/).first();
    await expect(firstTile).toBeVisible({ timeout: 10_000 });
    await firstTile.click();

    await expect(page.getByTestId('chat-interface')).toBeVisible({ timeout: 10_000 });
    // Input must be enabled initially (isStreaming was reset on session activation)
    // Wait a tick for the auto-send effect to fire, then verify it enters streaming state
    // rather than being stuck permanently disabled
    const chatInput = page.getByTestId('chat-input');
    // Should eventually re-enable after any LLM response or error
    await expect(chatInput).toBeEnabled({ timeout: 30_000 });
  });
});
