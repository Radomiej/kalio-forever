import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

test.describe('AC-19: Skills UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-mind').click();
    await page.getByTestId('mind-tab-skills').click();
  });

  test('Skills split panel renders: list and editor visible', async ({ page }) => {
    // SkillListPanel always visible on left
    await expect(page.locator('[data-testid="new-skill-btn"]')).toBeVisible();
    // Editor shows empty state when nothing selected
    await expect(page.locator('text=Select a skill to edit')).toBeVisible();
  });

  test('can create a skill via UI', async ({ page }) => {
    await page.getByTestId('new-skill-btn').click();
    // A new skill appears in the list and is auto-selected
    const item = page.getByTestId('skill-item').first();
    await expect(item).toBeVisible({ timeout: 5000 });
    // Editor opens with the new skill
    await expect(page.getByTestId('skill-editor')).toBeVisible();
  });

  test('can edit skill name and save via editor', async ({ page, request }) => {
    // Cleanup any leftover skills from prior runs
    const existing = await request.get(`${API_BASE}/skills`);
    const all: Array<{ id: string; name: string }> = await existing.json();
    await Promise.all(
      all.filter((s) => s.name === 'UI Edit Target' || s.name === 'UI Edit Renamed')
        .map((s) => request.delete(`${API_BASE}/skills/${s.id}`)),
    );

    // Seed a skill via API for isolation
    const res = await request.post(`${API_BASE}/skills`, {
      data: { name: 'UI Edit Target', description: 'desc', prompt: 'p' },
    });
    const skill = await res.json();

    await page.reload();
    await page.getByTestId('nav-mind').click();
    await page.getByTestId('mind-tab-skills').click();

    // Click the seeded skill in the list
    await page.getByTestId('skill-item').filter({ hasText: 'UI Edit Target' }).first().click();
    await expect(page.getByTestId('skill-editor')).toBeVisible();

    // Change name in the editor
    const nameInput = page.getByTestId('skill-name-input');
    await nameInput.fill('UI Edit Renamed');
    await page.getByTestId('skill-save-btn').click();
    await expect(page.getByTestId('skill-save-btn')).toContainText('Saved', { timeout: 3000 });

    // Verify via API
    const updated = await request.get(`${API_BASE}/skills/${skill.id}`);
    const data = await updated.json();
    expect(data.name).toBe('UI Edit Renamed');

    await request.delete(`${API_BASE}/skills/${skill.id}`);
  });

  test('can delete a skill via UI', async ({ page, request }) => {
    // Seed
    const res = await request.post(`${API_BASE}/skills`, {
      data: { name: 'UI Delete Target', description: '', prompt: '' },
    });
    const skill = await res.json();

    await page.reload();
    await page.getByTestId('nav-mind').click();
    await page.getByTestId('mind-tab-skills').click();

    const item = page.getByTestId('skill-item').filter({ hasText: 'UI Delete Target' });
    await expect(item).toBeVisible({ timeout: 5000 });

    // Hover to reveal delete button and click
    await item.hover();
    await item.locator('[data-testid="skill-delete-btn"]').click();

    await expect(item).not.toBeVisible({ timeout: 3000 });

    // Verify deleted via API
    const list = await request.get(`${API_BASE}/skills`);
    const skills: Array<{ id: string }> = await list.json();
    expect(skills.some((s) => s.id === skill.id)).toBeFalsy();
  });

  test('Skills tab does not bleed into other Mind tabs', async ({ page }) => {
    // Switch away from skills — SkillListPanel must not appear
    await page.getByTestId('mind-tab-memory').click();
    await expect(page.locator('[data-testid="new-skill-btn"]')).not.toBeVisible();

    await page.getByTestId('mind-tab-personas').click();
    await expect(page.locator('[data-testid="new-skill-btn"]')).not.toBeVisible();
  });
});
