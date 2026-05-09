import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-11: Persona system prompt + tool access is configured correctly
test.describe('AC-11: Persona system prompt & tool access', () => {
  test('GET /api/personas returns expected default personas and labels', async ({ request }) => {
    const res = await request.get(`${API_BASE}/personas`);
    expect(res.ok()).toBeTruthy();
    const personas = await res.json() as Array<{ id: string; name: string; allowedTools: string[]; skills?: string[] }>;
    expect(Array.isArray(personas)).toBe(true);

    const ids = personas.map((p) => p.id);
    expect(ids).toContain('default');
    expect(ids).toContain('ra-apps');
    expect(ids).toContain('builder');
    expect(ids).toContain('designer');
    expect(ids).toContain('dev');
    expect(ids).toContain('skill-persona-maker');
    expect(ids).toContain('jony');

    const byId = new Map(personas.map((p) => [p.id, p]));
    expect(byId.get('ra-apps')?.name).toBe('RaConsierge');
    expect(byId.get('builder')?.name).toBe('RaBuilder');
    expect(byId.get('designer')?.name).toBe('UX Designer');
    expect(byId.get('dev')?.name).toBe('Fullstack Dev');
    expect(byId.get('skill-persona-maker')?.name).toBe('Skill & Persona Maker');
    expect(byId.get('jony')?.name).toBe('Jony');

    const raApps = byId.get('ra-apps');
    expect(raApps?.allowedTools).toContain('run_raapp');
    expect(raApps?.allowedTools).toContain('list_raapps');
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

  test('Personas panel is accessible from Mind and lists defaults', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-mind').click();
    await page.getByTestId('mind-tab-personas').click();
    await expect(page.getByTestId('persona-panel')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="persona-item"]', { hasText: 'Default' }).first()).toBeVisible();
    await expect(page.locator('[data-testid="persona-item"]', { hasText: 'RaConsierge' }).first()).toBeVisible();
  });

  test('Persona edit in Mind shows tool toggles and saves tool list', async ({ page, request }) => {
    // Create a fresh persona so we can safely edit and delete it
    const res = await request.post(`${API_BASE}/personas`, {
      data: { name: 'AC11 Test Persona', systemPrompt: 'Test prompt', model: '', allowedTools: [] },
    });
    expect(res.ok()).toBeTruthy();
    const persona = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-mind').click();
    await page.getByTestId('mind-tab-personas').click();

    const row = page.locator('[data-testid="persona-item"]', { hasText: 'AC11 Test Persona' }).first();
    await expect(row).toBeVisible({ timeout: 5000 });
    await row.locator('button[title="Edit"]').click();
    await row.getByTestId('persona-tools-toggle').click();
    await expect(row.getByTestId('tool-toggle-run_raapp')).toBeVisible();
    await row.getByTestId('tool-toggle-run_raapp').locator('input[type="checkbox"]').check();
    await row.getByRole('button', { name: 'Save' }).click();

    await expect(row).toBeVisible();

    // Cleanup
    await request.delete(`${API_BASE}/personas/${persona.id}`);
  });

  test('default personas are visible in Mind personas list', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-mind').click();
    await page.getByTestId('mind-tab-personas').click();
    await expect(page.locator('[data-testid="persona-item"]', { hasText: 'Default' }).first()).toBeVisible();
    await expect(page.locator('[data-testid="persona-item"]', { hasText: 'RaConsierge' }).first()).toBeVisible();
  });

  test('Tools section shows renamed RaConsierge tab', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-tools').click();
    await expect(page.getByTestId('tools-tab-raapps')).toHaveText('RaConsierge');
  });
});
