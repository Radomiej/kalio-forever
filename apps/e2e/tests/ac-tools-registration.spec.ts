import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

const expectedTools = new Map<string, boolean>([
  ['vfs_write', true],
  ['vfs_read', false],
  ['vfs_list', false],
  ['run_subagent', false],
  ['fs_read', false],
  ['fs_list', false],
  ['fs_write', true],
  ['kv_write', true],
  ['kv_read', false],
  ['kv_list', false],
  ['kv_delete', true],
  ['grep_search', false],
  ['file_search', false],
  ['terminal_spawn', true],
  ['terminal_list', false],
  ['terminal_output', false],
  ['terminal_kill', true],
  ['raapp_create', true],
  ['raapp_compile', false],
  ['memory_ingest', true],
  ['memory_search', false],
  ['memory_ingest_conversation', true],
]);

test.describe('tool registry contract', () => {
  test('exposes the expected native tools with their HITL confirmation policy', async ({ request }) => {
    const res = await request.get(`${API_BASE}/tools`);
    expect(res.ok()).toBe(true);

    const tools = await res.json() as Array<{ name: string; requiresConfirmation: boolean }>;
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    for (const [name, requiresConfirmation] of expectedTools) {
      expect(byName.get(name), `Missing tool: ${name}`).toMatchObject({
        name,
        requiresConfirmation,
      });
    }
  });
});
