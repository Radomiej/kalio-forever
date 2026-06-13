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
  test('create form renders the tool picker in the editor section', async ({ page }) => {
    await goToPersonas(page);
    await page.getByTestId('new-persona-btn').click();

    await expect(page.getByText('Tools and MCP policy')).toBeVisible();
    await expect(page.getByTestId('persona-tool-picker')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('group-toggle-vfs')).toBeVisible({ timeout: 5000 });
  });

  test('Enable All / Disable All buttons work', async ({ page }) => {
    await goToPersonas(page);
    await page.getByTestId('new-persona-btn').click();

    const picker = page.getByTestId('persona-tool-picker');
    await expect(picker).toBeVisible({ timeout: 5000 });

    await picker.getByTestId('tools-enable-all').click();
    await expect(picker.getByTestId('group-toggle-vfs')).toBeChecked();
    await expect(picker.getByTestId('tool-toggle-vfs_read').locator('input[type="checkbox"]')).toBeChecked();
    await expect(picker.getByTestId('tool-toggle-memory_search').locator('input[type="checkbox"]')).toBeChecked();

    await picker.getByTestId('tools-disable-all').click();
    await expect(picker.getByTestId('group-toggle-vfs')).not.toBeChecked();
    await expect(picker.getByTestId('tool-toggle-vfs_read').locator('input[type="checkbox"]')).not.toBeChecked();
    await expect(picker.getByTestId('tool-toggle-memory_search').locator('input[type="checkbox"]')).not.toBeChecked();
  });

  test('group toggle selects all tools in group', async ({ page }) => {
    await goToPersonas(page);
    await page.getByTestId('new-persona-btn').click();

    const picker = page.getByTestId('persona-tool-picker');
    await expect(picker).toBeVisible({ timeout: 5000 });

    const vfsGroupToggle = picker.getByTestId('group-toggle-vfs');
    await expect(vfsGroupToggle).toBeVisible({ timeout: 5000 });
    await vfsGroupToggle.check();

    const vfsRead = picker.getByTestId('tool-toggle-vfs_read');
    await expect(vfsRead).toBeVisible();
    await expect(vfsRead.locator('input[type="checkbox"]')).toBeChecked();
  });

  test('individual tool toggle works', async ({ page }) => {
    await goToPersonas(page);
    await page.getByTestId('new-persona-btn').click();

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

  test('persona list meta shows tool count for saved tools', async ({ page, request }) => {
    const personaName = uniquePersonaName('AC04 Tools Badge');

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
    await expect(item).toContainText('3 tools');
    await expect(item).toContainText('MCP allow_all');

    await request.delete(`${API_BASE}/personas/${persona.id}`);
  });

  test('selecting a persona hydrates its saved tools in the main editor', async ({ page, request }) => {
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
    await item.click();

    await expect(page.getByTestId('persona-name-input')).toHaveValue(personaName);
    await expect(page.getByTestId('tool-toggle-vfs_read').locator('input[type="checkbox"]')).toBeChecked();
    await expect(page.getByTestId('tool-toggle-vfs_list').locator('input[type="checkbox"]')).toBeChecked();
    await expect(page.getByTestId('tool-toggle-terminal_spawn').locator('input[type="checkbox"]')).toBeChecked();

    await request.delete(`${API_BASE}/personas/${persona.id}`);
  });

  test('creates persona with selected tools and persists', async ({ page, request }) => {
    const personaName = uniquePersonaName('AC04 Tools Persist');

    await goToPersonas(page);
    await page.getByTestId('new-persona-btn').click();
    await page.getByTestId('persona-name-input').fill(personaName);
    await page.getByTestId('persona-model-input').fill('mock');

    const picker = page.getByTestId('persona-tool-picker');
    await expect(picker).toBeVisible({ timeout: 5000 });

    const vfsRead = picker.getByTestId('tool-toggle-vfs_read');
    await expect(vfsRead).toBeVisible({ timeout: 5000 });
    await vfsRead.click();

    await page.getByTestId('persona-save-btn').click();
    await expect(page.getByTestId('persona-name-input')).toHaveValue(personaName);
    await expect(page.getByTestId('persona-item').filter({ hasText: personaName })).toBeVisible({ timeout: 5000 });

    // Verify via API
    const list = await request.get(`${API_BASE}/personas`);
    const personas: Array<{ id: string; name: string; allowedTools: string[] }> = await list.json();
    const created = personas.find((p) => p.name === personaName);
    expect(created).toBeDefined();
    expect(created!.allowedTools).toContain('vfs_read');

    if (created) await request.delete(`${API_BASE}/personas/${created.id}`);
  });
});
