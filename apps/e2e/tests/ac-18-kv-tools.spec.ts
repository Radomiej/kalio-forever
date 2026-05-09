import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-18: KV storage tools are registered and available
test.describe('AC-18: KV storage tools registration', () => {
  test('all 4 kv tools are registered', async ({ request }) => {
    const res = await request.get(`${API_BASE}/tools`);
    expect(res.ok()).toBeTruthy();
    const tools: Array<{ name: string }> = await res.json();
    const names = tools.map((t) => t.name);
    expect(names).toContain('kv_write');
    expect(names).toContain('kv_read');
    expect(names).toContain('kv_list');
    expect(names).toContain('kv_delete');
  });

  test('kv_write requires confirmation', async ({ request }) => {
    const res = await request.get(`${API_BASE}/tools`);
    const tools: Array<{ name: string; requiresConfirmation: boolean }> = await res.json();
    const kvWrite = tools.find((t) => t.name === 'kv_write');
    expect(kvWrite?.requiresConfirmation).toBe(true);
  });
});
