import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3016';

test.describe('AC-25: RAApp and Memory tools registered', () => {
  test('GET /api/tools returns 22 tools', async ({ request }) => {
    const res = await request.get(`${BASE}/api/tools`);
    expect(res.ok()).toBe(true);
    const tools: { name: string }[] = await res.json();
    expect(tools.length).toBeGreaterThanOrEqual(22);
  });

  test('raapp_create and raapp_compile tools are registered', async ({ request }) => {
    const res = await request.get(`${BASE}/api/tools`);
    const tools: { name: string; requiresConfirmation: boolean }[] = await res.json();
    const names = tools.map((t) => t.name);

    expect(names).toContain('raapp_create');
    expect(names).toContain('raapp_compile');

    const raappCreate = tools.find((t) => t.name === 'raapp_create');
    const raappCompile = tools.find((t) => t.name === 'raapp_compile');
    expect(raappCreate?.requiresConfirmation).toBe(true);
    expect(raappCompile?.requiresConfirmation).toBe(false);
  });

  test('memory_ingest, memory_search, memory_ingest_conversation tools are registered', async ({ request }) => {
    const res = await request.get(`${BASE}/api/tools`);
    const tools: { name: string; requiresConfirmation: boolean }[] = await res.json();
    const names = tools.map((t) => t.name);

    expect(names).toContain('memory_ingest');
    expect(names).toContain('memory_search');
    expect(names).toContain('memory_ingest_conversation');

    const memoryIngest = tools.find((t) => t.name === 'memory_ingest');
    const memorySearch = tools.find((t) => t.name === 'memory_search');
    const memoryIngestConv = tools.find((t) => t.name === 'memory_ingest_conversation');

    expect(memoryIngest?.requiresConfirmation).toBe(true);
    expect(memorySearch?.requiresConfirmation).toBe(false);
    expect(memoryIngestConv?.requiresConfirmation).toBe(true);
  });

  test('all 22 expected tool names are present', async ({ request }) => {
    const res = await request.get(`${BASE}/api/tools`);
    const tools: { name: string }[] = await res.json();
    const names = tools.map((t) => t.name);

    const expected = [
      'vfs_write', 'vfs_read', 'vfs_list', 'run_subagent',
      'fs_read', 'fs_list', 'fs_write',
      'kv_write', 'kv_read', 'kv_list', 'kv_delete',
      'grep_search', 'file_search',
      'terminal_spawn', 'terminal_list', 'terminal_output', 'terminal_kill',
      'raapp_create', 'raapp_compile',
      'memory_ingest', 'memory_search', 'memory_ingest_conversation',
    ];
    for (const name of expected) {
      expect(names, `Missing tool: ${name}`).toContain(name);
    }
  });
});
