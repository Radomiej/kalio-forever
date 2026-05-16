import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

test.describe('AC-24: All tools available by default (empty skills)', () => {
  test('GET /api/tools returns at least 17 tools', async ({ request }) => {
    const res = await request.get(`${API_BASE}/tools`);
    expect(res.ok()).toBe(true);
    const tools: { name: string }[] = await res.json();
    // 11 original + 2 file search + 4 terminal = 17
    expect(tools.length).toBeGreaterThanOrEqual(17);
  });

  test('all expected tool names are present', async ({ request }) => {
    const res = await request.get(`${API_BASE}/tools`);
    const tools: { name: string }[] = await res.json();
    const names = tools.map((t) => t.name);

    const expected = [
      'vfs_write', 'vfs_read', 'vfs_list', 'run_subagent',
      'fs_read', 'fs_list', 'fs_write',
      'kv_write', 'kv_read', 'kv_list', 'kv_delete',
      'grep_search', 'file_search',
      'terminal_spawn', 'terminal_list', 'terminal_output', 'terminal_kill',
    ];
    for (const name of expected) {
      expect(names, `Missing tool: ${name}`).toContain(name);
    }
  });
});
