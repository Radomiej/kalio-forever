import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-19: Skills CRUD API
test.describe('AC-19: Skills CRUD', () => {
  test('full CRUD lifecycle', async ({ request }) => {
    // Create
    const createRes = await request.post(`${API_BASE}/skills`, {
      data: { name: 'Test Skill E2E', description: 'desc', prompt: 'You are a test assistant.' },
    });
    expect(createRes.ok()).toBeTruthy();
    const skill = await createRes.json();
    expect(skill.id).toBeDefined();
    expect(skill.name).toBe('Test Skill E2E');
    const skillId: string = skill.id;

    // List
    const listRes = await request.get(`${API_BASE}/skills`);
    const skills: Array<{ id: string; name: string }> = await listRes.json();
    expect(skills.some((s) => s.name === 'Test Skill E2E')).toBeTruthy();

    // Update
    const updateRes = await request.put(`${API_BASE}/skills/${skillId}`, {
      data: { name: 'Updated Skill E2E', description: 'desc', prompt: 'Updated prompt' },
    });
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();
    expect(updated.name).toBe('Updated Skill E2E');

    // Delete
    const delRes = await request.delete(`${API_BASE}/skills/${skillId}`);
    expect(delRes.ok()).toBeTruthy();
    const afterDelete = await request.get(`${API_BASE}/skills`);
    const remaining: Array<{ id: string }> = await afterDelete.json();
    expect(remaining.some((s) => s.id === skillId)).toBeFalsy();
  });
});
