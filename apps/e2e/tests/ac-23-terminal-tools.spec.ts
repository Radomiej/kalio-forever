import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3016';

test.describe('AC-23: Terminal tools registration', () => {
  test('all 4 terminal tools are registered', async ({ request }) => {
    const res = await request.get(`${BASE}/api/tools`);
    expect(res.ok()).toBe(true);
    const tools: { name: string; requiresConfirmation: boolean }[] = await res.json();
    const names = tools.map((t) => t.name);

    expect(names).toContain('terminal_spawn');
    expect(names).toContain('terminal_list');
    expect(names).toContain('terminal_output');
    expect(names).toContain('terminal_kill');
  });

  test('terminal_spawn and terminal_kill require confirmation', async ({ request }) => {
    const res = await request.get(`${BASE}/api/tools`);
    const tools: { name: string; requiresConfirmation: boolean }[] = await res.json();

    const spawn = tools.find((t) => t.name === 'terminal_spawn');
    const kill = tools.find((t) => t.name === 'terminal_kill');
    expect(spawn!.requiresConfirmation).toBe(true);
    expect(kill!.requiresConfirmation).toBe(true);
  });

  test('terminal_list and terminal_output do not require confirmation', async ({ request }) => {
    const res = await request.get(`${BASE}/api/tools`);
    const tools: { name: string; requiresConfirmation: boolean }[] = await res.json();

    const list = tools.find((t) => t.name === 'terminal_list');
    const output = tools.find((t) => t.name === 'terminal_output');
    expect(list!.requiresConfirmation).toBe(false);
    expect(output!.requiresConfirmation).toBe(false);
  });
});
