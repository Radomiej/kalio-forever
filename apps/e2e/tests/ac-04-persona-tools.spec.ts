import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

function uniquePersonaName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function goToPersonas(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByTestId('nav-mind').click();
  await page.getByTestId('mind-tab-personas').click();
}

test.describe('AC-04: Persona Tool Picker', () => {
  test('create form has a collapsible Tools section', async ({ page }) => {
    await goToPersonas(page);
    await page.getByTestId('new-persona-btn').click();

    const toggle = page.getByTestId('persona-tools-toggle');
    await expect(toggle).toBeVisible();
    // Tool picker hidden by default
    await expect(page.getByTestId('persona-tool-picker')).not.toBeVisible();
    // Open it
    await toggle.click();
    await expect(page.getByTestId('persona-tool-picker')).toBeVisible({ timeout: 5000 });
  });

  test('Enable All / Disable All buttons work', async ({ page }) => {
    await goToPersonas(page);
    await page.getByTestId('new-persona-btn').click();
    await page.getByTestId('persona-tools-toggle').click();

    const picker = page.getByTestId('persona-tool-picker');
    await expect(picker).toBeVisible({ timeout: 5000 });

    // Enable all
    await picker.getByTestId('tools-enable-all').click();
    // At least one checkbox should be checked
    const firstCheckbox = picker.locator('input[type="checkbox"]').nth(1);
    await expect(firstCheckbox).toBeChecked();

    // Disable all
    await picker.getByTestId('tools-disable-all').click();
    // All checkboxes unchecked
    const checkboxes = picker.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).not.toBeChecked();
    }
  });

  test('group toggle selects all tools in group', async ({ page }) => {
    await goToPersonas(page);
    await page.getByTestId('new-persona-btn').click();
    await page.getByTestId('persona-tools-toggle').click();

    const picker = page.getByTestId('persona-tool-picker');
    await expect(picker).toBeVisible({ timeout: 5000 });

    // Toggle the VFS group
    const vfsGroupToggle = picker.getByTestId('group-toggle-vfs');
    await expect(vfsGroupToggle).toBeVisible({ timeout: 5000 });
    await vfsGroupToggle.check();

    // vfs_read should now be checked
    const vfsRead = picker.getByTestId('tool-toggle-vfs_read');
    await expect(vfsRead).toBeVisible();
    await expect(vfsRead.locator('input[type="checkbox"]')).toBeChecked();
  });

  test('individual tool toggle works', async ({ page }) => {
    await goToPersonas(page);
    await page.getByTestId('new-persona-btn').click();
    await page.getByTestId('persona-tools-toggle').click();

    const picker = page.getByTestId('persona-tool-picker');
    await expect(picker).toBeVisible({ timeout: 5000 });

    const memoryToggle = picker.getByTestId('tool-toggle-memory_search');
    await expect(memoryToggle).toBeVisible({ timeout: 5000 });
    const cb = memoryToggle.locator('input[type="checkbox"]');
    await expect(cb).not.toBeChecked();
    await memoryToggle.click();
    await expect(cb).toBeChecked();
    await memoryToggle.click();
    await expect(cb).not.toBeChecked();
  });

  test('tools badge shows count when persona has tools', async ({ page, request }) => {
    const personaName = uniquePersonaName('AC04 Tools Badge');

    // Create persona with tools via API
    const res = await request.post(`${API_BASE}/personas`, {
      data: {
        name: personaName,
        systemPrompt: 'test',
        model: 'mock',
        allowedTools: ['vfs_read', 'vfs_write', 'memory_search'],
      },
    });
    const persona = await res.json();

    await goToPersonas(page);

  const item = page.getByTestId('persona-item').filter({ hasText: personaName });
    await expect(item).toBeVisible({ timeout: 5000 });
    // Badge shows "3"
    await expect(item.locator('.badge', { hasText: '3' })).toBeVisible();

    await request.delete(`${API_BASE}/personas/${persona.id}`);
  });

  test('tool badges shown in expanded read view', async ({ page, request }) => {
    const personaName = uniquePersonaName('AC04 Tools Expanded');

    const res = await request.post(`${API_BASE}/personas`, {
      data: {
        name: personaName,
        systemPrompt: 'test',
        model: 'mock',
        allowedTools: ['vfs_read', 'vfs_list', 'terminal_spawn'],
      },
    });
    const persona = await res.json();

    await goToPersonas(page);

  const item = page.getByTestId('persona-item').filter({ hasText: personaName });
    await expect(item).toBeVisible({ timeout: 5000 });
    // Expand
    await item.locator('button').first().click();
    // VFS group badge should appear (2 vfs tools)
    await expect(page.locator('.badge', { hasText: /VFS/ })).toBeVisible();
    await expect(page.locator('.badge', { hasText: /Terminal/ })).toBeVisible();

    await request.delete(`${API_BASE}/personas/${persona.id}`);
  });

  test('creates persona with selected tools and persists', async ({ page, request }) => {
    const personaName = uniquePersonaName('AC04 Tools Persist');

    await goToPersonas(page);
    await page.getByTestId('new-persona-btn').click();
    await page.getByTestId('persona-name-input').fill(personaName);
    await page.getByTestId('persona-model-input').fill('mock');
    await page.getByTestId('persona-tools-toggle').click();

    const picker = page.getByTestId('persona-tool-picker');
    await expect(picker).toBeVisible({ timeout: 5000 });

    // Enable vfs_read
    const vfsRead = picker.getByTestId('tool-toggle-vfs_read');
    await expect(vfsRead).toBeVisible({ timeout: 5000 });
    await vfsRead.click();

    await page.getByTestId('persona-save-btn').click();
    await expect(page.getByTestId('persona-name-input')).not.toBeVisible({ timeout: 3000 });

    // Verify via API
    const list = await request.get(`${API_BASE}/personas`);
    const personas: Array<{ id: string; name: string; allowedTools: string[] }> = await list.json();
    const created = personas.find((p) => p.name === personaName);
    expect(created).toBeDefined();
    expect(created!.allowedTools).toContain('vfs_read');

    if (created) await request.delete(`${API_BASE}/personas/${created.id}`);
  });
});
