import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-04: Persona CRUD — user can create, view, and delete personas
test.describe('AC-04: Persona CRUD', () => {
  test('user can create a new persona via API', async ({ request }) => {
    const res = await request.post(`${API_BASE}/personas`, {
      data: { name: 'AC04 Test Persona', systemPrompt: 'You are a test assistant.', model: 'mock', allowedTools: [] },
    });
    expect(res.ok()).toBeTruthy();
    const persona = await res.json();
    expect(persona.id).toBeDefined();
    expect(persona.name).toBe('AC04 Test Persona');
    // cleanup
    await request.delete(`${API_BASE}/personas/${persona.id}`);
  });

  test('created persona appears in persona panel', async ({ page, request }) => {
    const createRes = await request.post(`${API_BASE}/personas`, {
      data: { name: 'AC04 Panel Persona', systemPrompt: 'Test', model: 'mock', allowedTools: [] },
    });
    const persona = await createRes.json();

    await page.goto('/');
    await page.getByTestId('nav-mind').click();
    // Click Personas tab in Mind section
    await page.getByRole('button', { name: 'Personas' }).click();
    await expect(
      page.getByTestId('persona-item').filter({ hasText: 'AC04 Panel Persona' }).first(),
    ).toBeVisible({ timeout: 5000 });

    await request.delete(`${API_BASE}/personas/${persona.id}`);
  });

  test('deleting a persona removes it from the list', async ({ request }) => {
    const createRes = await request.post(`${API_BASE}/personas`, {
      data: { name: 'AC04 Delete Me', systemPrompt: 'Test', model: 'mock', skills: [] },
    });
    const persona = await createRes.json();

    const delRes = await request.delete(`${API_BASE}/personas/${persona.id}`);
    expect(delRes.status()).toBe(204);

    const listRes = await request.get(`${API_BASE}/personas`);
    const list: Array<{ id: string }> = await listRes.json();
    expect(list.some((p) => p.id === persona.id)).toBeFalsy();
  });
});
