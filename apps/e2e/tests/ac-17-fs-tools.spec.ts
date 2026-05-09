import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-17: Filesystem tools (fs_read, fs_list, fs_write) are registered and available
test.describe('AC-17: Filesystem tools registration', () => {
  test('fs_read tool is registered', async ({ request }) => {
    const res = await request.get(`${API_BASE}/tools`);
    expect(res.ok()).toBeTruthy();
    const tools: Array<{ name: string }> = await res.json();
    const names = tools.map((t) => t.name);
    expect(names).toContain('fs_read');
  });

  test('fs_list tool is registered', async ({ request }) => {
    const res = await request.get(`${API_BASE}/tools`);
    const tools: Array<{ name: string }> = await res.json();
    expect(tools.map((t) => t.name)).toContain('fs_list');
  });

  test('fs_write tool is registered with requiresConfirmation', async ({ request }) => {
    const res = await request.get(`${API_BASE}/tools`);
    const tools: Array<{ name: string; requiresConfirmation: boolean }> = await res.json();
    const fsWrite = tools.find((t) => t.name === 'fs_write');
    expect(fsWrite).toBeDefined();
    expect(fsWrite?.requiresConfirmation).toBe(true);
  });
});
