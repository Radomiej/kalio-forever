import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

const expectedTools = new Map<string, boolean>([
  ['vfs_write', true],
  ['vfs_read', false],
  ['vfs_list', false],
  ['vfs_grep_search', false],
  ['vfs_file_search', false],
  ['run_subagent', false],
  ['spawn_subagent', false],
  ['message_subagent', false],
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
  ['spawn_cli_agent', true],
  ['message_cli_agent', true],
  ['get_cli_agent_status', false],
  ['stop_cli_agent', true],
  ['run_cli_agent', true],
  ['raapp_create', true],
  ['raapp_compile', false],
  ['run_raapp', false],
  ['list_raapps', false],
  ['design_preview', false],
  ['raapp_get', false],
  ['raapp_edit', true],
  ['raapp_delete', true],
  ['raapp_create_draft', true],
  ['raapp_execute_dsl', false],
  ['raapp_publish_draft', true],
  ['raapp_test', false],
  ['memory_ingest', true],
  ['memory_search', false],
  ['memory_ingest_conversation', true],
  ['web_search', false],
  ['list_tools', false],
  ['get_tool_details', false],
  ['image_generate', true],
  ['image_edit', true],
  ['image_view', false],
  ['skill_list', false],
  ['skill_read', false],
  ['skill_create', true],
  ['skill_update', true],
  ['skill_delete', true],
  ['persona_list', false],
  ['persona_create', true],
  ['persona_update', true],
  ['persona_delete', true],
  ['escalate', false],
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
