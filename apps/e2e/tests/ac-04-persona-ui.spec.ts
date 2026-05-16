import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

const APP_URL = 'http://localhost:5188';

function uniquePersonaName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test.describe('AC-04: Personas UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL);
    await page.getByTestId('nav-mind').click();
    await page.getByTestId('mind-tab-personas').click();
  });

  test('Personas panel renders with add button', async ({ page }) => {
    await expect(page.getByTestId('persona-panel')).toBeVisible();
    await expect(page.getByTestId('new-persona-btn')).toBeVisible();
  });

  test('can open create form', async ({ page }) => {
    await page.getByTestId('new-persona-btn').click();
    await expect(page.getByTestId('persona-name-input')).toBeVisible();
    await expect(page.getByTestId('persona-model-input')).toBeVisible();
    await expect(page.getByTestId('persona-prompt-textarea')).toBeVisible();
    await expect(page.getByTestId('persona-save-btn')).toBeVisible();
  });

  test('save button disabled when name is empty', async ({ page }) => {
    await page.getByTestId('new-persona-btn').click();
    const saveBtn = page.getByTestId('persona-save-btn');
    await expect(saveBtn).toBeDisabled();
    await page.getByTestId('persona-name-input').fill('My Persona');
    await expect(saveBtn).not.toBeDisabled();
  });

  test('can create a persona via UI', async ({ page, request }) => {
    const personaName = uniquePersonaName('UI Created Persona');

    await page.getByTestId('new-persona-btn').click();
    await page.getByTestId('persona-name-input').fill(personaName);
    await page.getByTestId('persona-model-input').fill('mock');
    await page.getByTestId('persona-prompt-textarea').fill('You are a test persona.');
    await page.getByTestId('persona-save-btn').click();

    // Form should close and new persona should appear in list
    await expect(page.getByTestId('persona-name-input')).not.toBeVisible({ timeout: 3000 });
    await expect(
      page.getByTestId('persona-item').filter({ hasText: personaName }),
    ).toBeVisible({ timeout: 10000 });

    // Cleanup
    const list = await request.get(`${API_BASE}/personas`);
    const personas: Array<{ id: string; name: string }> = await list.json();
    const created = personas.find((p) => p.name === personaName);
    if (created) await request.delete(`${API_BASE}/personas/${created.id}`);
  });

  test('seeded persona visible in panel', async ({ page, request }) => {
    const personaName = uniquePersonaName('AC04 UI Seeded');
    const res = await request.post(`${API_BASE}/personas`, {
      data: { name: personaName, systemPrompt: 'test', model: 'mock', skills: [] },
    });
    const persona = await res.json();

    await page.reload();
    await page.getByTestId('nav-mind').click();
    await page.getByTestId('mind-tab-personas').click();

    await expect(
      page.getByTestId('persona-item').filter({ hasText: personaName }),
    ).toBeVisible({ timeout: 5000 });

    await request.delete(`${API_BASE}/personas/${persona.id}`);
  });

  test('can delete a persona via UI', async ({ page, request }) => {
    const personaName = uniquePersonaName('AC04 UI Delete Me');
    const res = await request.post(`${API_BASE}/personas`, {
      data: { name: personaName, systemPrompt: 'test', model: 'mock', skills: [] },
    });
    const persona = await res.json();

    await page.reload();
    await page.getByTestId('nav-mind').click();
    await page.getByTestId('mind-tab-personas').click();

    const item = page.getByTestId('persona-item').filter({ hasText: personaName });
    await expect(item).toBeVisible({ timeout: 5000 });
    await item.locator('[data-testid="persona-delete-btn"]').click();
    await expect(item).not.toBeVisible({ timeout: 3000 });

    // Verify removed via API
    const list = await request.get(`${API_BASE}/personas`);
    const personas: Array<{ id: string }> = await list.json();
    expect(personas.some((p) => p.id === persona.id)).toBeFalsy();
  });

  test('can expand a persona to view system prompt', async ({ page, request }) => {
    const personaName = uniquePersonaName('AC04 Expand Me');
    const res = await request.post(`${API_BASE}/personas`, {
      data: { name: personaName, systemPrompt: 'Expand system prompt content here.', model: 'mock', skills: [] },
    });
    const persona = await res.json();

    await page.reload();
    await page.getByTestId('nav-mind').click();
    await page.getByTestId('mind-tab-personas').click();

    const item = page.getByTestId('persona-item').filter({ hasText: personaName });
    await expect(item).toBeVisible({ timeout: 5000 });
    // Click the expand button (the main row toggle)
    await item.locator('button').first().click();
    await expect(page.locator('text=Expand system prompt content here.')).toBeVisible();

    await request.delete(`${API_BASE}/personas/${persona.id}`);
  });

  test('Personas tab does not show Skills UI', async ({ page }) => {
    await expect(page.locator('[data-testid="new-skill-btn"]')).not.toBeVisible();
    await expect(page.getByTestId('skill-editor')).not.toBeVisible();
  });
});
