import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-10: RA-Apps load on landing page and tile-click navigates to chat
test.describe('AC-10: RA-App rendering', () => {
  test('calculator opens with a result and graph preview preserves manual zoom after Fit', async ({ page }) => {
    await page.setViewportSize({ width: 980, height: 950 });
    await page.goto('/');
    await page.getByTestId('app-tile-visual-calculator').click();
    await expect(page.getByText('12 + 4 = 16', { exact: true })).toBeVisible();
    await page.getByTestId('talk-graph-switcher').click();
    const artifact = page.getByTestId(/^graph-node-artifact:.*:raapp$/);
    await artifact.click();
    await page.getByTestId('graph-live-preview-toggle').click();
    await expect(page.getByTestId('graph-live-preview').getByText('12 + 4 = 16', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'More graph controls' }).click();
    await page.getByTestId('graph-fit-all').click();
    const zoom = page.getByText(/^\d+%$/, { exact: true });
    const fitted = Number.parseInt(await zoom.innerText(), 10);
    await page.getByTestId('graph-zoom-in').click();
    await expect.poll(async () => Number.parseInt(await zoom.innerText(), 10)).toBeGreaterThan(fitted);
    const manualZoom = await zoom.innerText();
    await page.getByTestId('graph-live-preview-toggle').click();
    await expect(zoom).toHaveText(manualZoom);
  });

  test('compact chat keeps one composer and its draft while settings collapse', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    const hideConversations = page.getByRole('button', { name: 'Hide conversations', exact: true });
    if (await hideConversations.isVisible()) await hideConversations.click();
    const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
    const settings = page.getByRole('button', { name: 'Conversation settings', exact: true });
    const persona = page.getByRole('combobox', { name: 'Persona', exact: true });
    await expect(prompt).toBeVisible();
    await expect(settings).toHaveAttribute('aria-expanded', 'false');
    await prompt.fill('Keep this draft');
    await settings.click();
    await expect(persona).toBeVisible();
    await expect(prompt).toHaveValue('Keep this draft');
    await settings.click();
    await expect(persona).toBeHidden();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(persona).toBeVisible();
    await expect(prompt).toHaveValue('Keep this draft');
  });

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
