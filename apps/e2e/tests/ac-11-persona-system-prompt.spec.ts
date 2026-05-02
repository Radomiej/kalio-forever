import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-11: Persona system prompt + tool access is configured correctly
test.describe('AC-11: Persona system prompt & tool access', () => {
  test('GET /api/personas returns default and ra-apps system personas', async ({ request }) => {
    const res = await request.get(`${API_BASE}/personas`);
    expect(res.ok()).toBeTruthy();
    const personas = await res.json() as Array<{ id: string; name: string; allowedTools: string[] }>;
    expect(Array.isArray(personas)).toBe(true);

    const ids = personas.map((p) => p.id);
    expect(ids).toContain('default');
    expect(ids).toContain('ra-apps');

    const raApps = personas.find((p) => p.id === 'ra-apps')!;
    expect(raApps.skills).toContain('raapp_create');
    expect(raApps.skills).toContain('raapp_compile');
  });

  test('GET /api/tools returns all registered tools', async ({ request }) => {
    const res = await request.get(`${API_BASE}/tools`);
    expect(res.ok()).toBeTruthy();
    const tools = await res.json() as Array<{ name: string; description: string }>;
    expect(Array.isArray(tools)).toBe(true);
    const names = tools.map((t) => t.name);
    expect(names).toContain('raapp_create');
    expect(names).toContain('raapp_compile');
    expect(names).toContain('vfs_write');
    expect(names).toContain('memory_search');
  });

  test('RA-App tile creates session with ra-apps persona', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('landing-page')).toBeVisible({ timeout: 5000 });
    const firstTile = page.getByTestId(/^app-tile-/).first();
    await expect(firstTile).toBeVisible({ timeout: 10_000 });

    // Intercept the session creation call to verify personaId
    const sessionReq = page.waitForRequest(
      (req) => req.url().includes('/api/sessions') && req.method() === 'POST',
    );
    await firstTile.click();
    const req = await sessionReq;
    const body = req.postDataJSON() as { personaId: string };
    expect(body.personaId).toBe('ra-apps');
  });

  test('Personas settings panel is accessible and lists personas', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-modal')).toBeVisible();
    await page.getByTestId('settings-tab-personas').click();
    await expect(page.getByTestId('personas-panel')).toBeVisible({ timeout: 5000 });

    // Both system personas listed
    await expect(page.getByTestId('persona-row-default')).toBeVisible();
    await expect(page.getByTestId('persona-row-ra-apps')).toBeVisible();
  });

  test('Persona edit shows tool toggles and saves skill list', async ({ page, request }) => {
    // Create a fresh persona so we can safely edit and delete it
    const res = await request.post(`${API_BASE}/personas`, {
      data: { name: 'AC11 Test Persona', systemPrompt: 'Test prompt', model: '', skills: [] },
    });
    expect(res.ok()).toBeTruthy();
    const persona = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-tab-personas').click();
    await expect(page.getByTestId(`persona-row-${persona.id}`)).toBeVisible({ timeout: 5000 });
    await page.getByTestId(`persona-row-${persona.id}`).click();

    // Edit panel should show
    await expect(page.getByTestId('persona-edit-panel')).toBeVisible();
    // Tool toggles should be present
    await expect(page.getByTestId('tool-toggle-raapp_create')).toBeVisible();
    await expect(page.getByTestId('tool-toggle-all')).toBeVisible();

    // Uncheck "all tools" to enter explicit mode
    const allToggle = page.getByTestId('tool-toggle-all');
    const isAllChecked = await allToggle.isChecked();
    if (isAllChecked) {
      await allToggle.uncheck();
    }

    // Enable just raapp_create
    await page.getByTestId('tool-toggle-raapp_create').locator('input[type="checkbox"]').check();

    await page.getByTestId('persona-save-btn').click();
    await expect(page.getByTestId('persona-edit-panel')).not.toBeVisible({ timeout: 5000 });

    // Verify via API that skills were saved
    const updated = await request.get(`${API_BASE}/personas/${persona.id}`);
    const updatedData = await updated.json() as { skills: string[] };
    expect(updatedData.skills).toContain('raapp_create');

    // Cleanup
    await request.delete(`${API_BASE}/personas/${persona.id}`);
  });

  test('system personas (default, ra-apps) cannot be deleted', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-tab-personas').click();
    await page.getByTestId('persona-row-ra-apps').click();

    await expect(page.getByTestId('persona-edit-panel')).toBeVisible();
    // Delete button should not exist for system personas
    await expect(page.getByTestId('persona-delete-btn')).not.toBeVisible();
  });
});
