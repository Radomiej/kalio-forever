import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-20: Agent Loop CRUD + status transitions
test.describe('AC-20: Agent Loop CRUD', () => {
  test.skip(true, 'Agent loop CRUD endpoints were removed with migration 0003_loops_remove_tool_overrides.');

  test('full CRUD lifecycle', async ({ request }) => {
    // Create
    const createRes = await request.post(`${API_BASE}/agent-loops`, {
      data: { name: 'E2E Test Loop', personaId: 'default', systemPrompt: 'Test loop', mode: 'continuous' },
    });
    expect(createRes.ok()).toBeTruthy();
    const loop = await createRes.json();
    expect(loop.id).toBeDefined();
    expect(loop.name).toBe('E2E Test Loop');
    expect(loop.status).toBe('idle');
    const loopId: string = loop.id;

    // List
    const listRes = await request.get(`${API_BASE}/agent-loops`);
    const loops: Array<{ id: string }> = await listRes.json();
    expect(loops.some((l) => l.id === loopId)).toBeTruthy();

    // Add task
    const taskRes = await request.post(`${API_BASE}/agent-loops/${loopId}/tasks`, {
      data: { loopId, title: 'Test task', priority: 5 },
    });
    expect(taskRes.ok()).toBeTruthy();
    const task = await taskRes.json();
    expect(task.title).toBe('Test task');
    expect(task.status).toBe('pending');

    // Delete
    const delRes = await request.delete(`${API_BASE}/agent-loops/${loopId}`);
    expect(delRes.ok()).toBeTruthy();
    const afterDelete = await request.get(`${API_BASE}/agent-loops`);
    const remaining: Array<{ id: string }> = await afterDelete.json();
    expect(remaining.some((l) => l.id === loopId)).toBeFalsy();
  });
});
