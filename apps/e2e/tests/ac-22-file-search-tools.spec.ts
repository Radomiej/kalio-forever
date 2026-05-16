import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

test.describe('AC-22: File search tools registration', () => {
  test('grep_search and file_search are registered', async ({ request }) => {
    const res = await request.get(`${API_BASE}/tools`);
    expect(res.ok()).toBe(true);
    const tools: { name: string; requiresConfirmation: boolean }[] = await res.json();
    const names = tools.map((t) => t.name);

    expect(names).toContain('grep_search');
    expect(names).toContain('file_search');
  });

  test('grep_search does not require confirmation', async ({ request }) => {
    const res = await request.get(`${API_BASE}/tools`);
    const tools: { name: string; requiresConfirmation: boolean }[] = await res.json();
    const grep = tools.find((t) => t.name === 'grep_search');
    expect(grep).toBeDefined();
    expect(grep!.requiresConfirmation).toBe(false);
  });

  test('file_search does not require confirmation', async ({ request }) => {
    const res = await request.get(`${API_BASE}/tools`);
    const tools: { name: string; requiresConfirmation: boolean }[] = await res.json();
    const fs = tools.find((t) => t.name === 'file_search');
    expect(fs).toBeDefined();
    expect(fs!.requiresConfirmation).toBe(false);
  });
});
