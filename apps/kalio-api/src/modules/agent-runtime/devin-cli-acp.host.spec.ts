import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDevinCliConfig } from './devin-cli-config';
import { suppressInheritedDevinMcp } from './devin-cli-mcp-catalog';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { buildDevinCliLaunchSpec, DevinAcpHost, parseDevinCliProbe } from './devin-cli-acp.host';

const catalog = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('node:child_process', async original => {
  const actual = await original<typeof import('node:child_process')>();
  const { promisify } = await import('node:util');
  const execFile = vi.fn();
  Object.defineProperty(execFile, promisify.custom, { value: catalog.read });
  return { ...actual, execFile };
});

describe('Devin CLI ACP host contract', () => {
  it.each([false, true])('shares the project directory only when native filesystem access is enabled (%s)', filesystem => {
    const host = new DevinAcpHost('swe-2', { filesystem, terminal: false, web: false, source: 'default' });
    const fixture = host as unknown as {
      lifecycle: { config: { cwd: string } };
      capabilities: { sessionCapabilities: { additionalDirectories: object } };
      buildSessionWorkspace(cwd: string): { cwd: string; additionalDirectories?: string[] };
    };
    fixture.lifecycle.config = { cwd: '/private-workspace' };
    fixture.capabilities = { sessionCapabilities: { additionalDirectories: {} } };
    expect(fixture.buildSessionWorkspace('/game')).toEqual({
      cwd: '/private-workspace',
      ...(filesystem ? { additionalDirectories: ['/game'] } : {}),
    });
  });
  it('suppresses all inherited MCP entries with empty allowlist and blocks failed verification', async () => {
    const enabled = 'Configured MCP servers:\n  • inherited\n    Command: private-command\n';
    const disabled = 'Configured MCP servers:\n  ✗ inherited  (disabled)\n    Command: private-command\n';
    const config = await createDevinCliConfig('exact-model', [], { filesystem: false, web: false, terminal: false, source: 'default' });
    try {
      catalog.read.mockReset().mockResolvedValueOnce({ stdout: 'devin 3000.11.1', stderr: '' })
        .mockResolvedValueOnce({ stdout: enabled, stderr: '' }).mockResolvedValueOnce({ stdout: disabled, stderr: '' });
      await expect(suppressInheritedDevinMcp('fixture-not-executed', config, [])).resolves.toBe(1);
      const overlay = JSON.parse(await readFile(join(config.cwd, '.devin', 'mcp_config.local.json'), 'utf8')) as {
        mcpServers: Record<string, { disabled?: boolean }>;
      };
      expect(Object.keys(overlay.mcpServers)).toEqual(['inherited']);
      expect(Object.values(overlay.mcpServers).every(server => server.disabled === true)).toBe(true);
      catalog.read.mockReset().mockResolvedValueOnce({ stdout: 'devin 3000.11.1', stderr: '' })
        .mockResolvedValueOnce({ stdout: enabled, stderr: '' }).mockResolvedValueOnce({ stdout: enabled, stderr: '' });
      await expect(suppressInheritedDevinMcp('fixture-not-executed', config, [])).rejects.toThrow('suppression did not take effect');
    } finally { await config.cleanup(); }
  });
  it('propagates initialization failure instead of exposing the assigned transport', async () => {
    let fail!: (error: Error) => void;
    const host = new DevinAcpHost('swe-2');
    const internals = host as unknown as {
      starting: Promise<void>; connection: { signal: AbortSignal };
      capabilities: { mcpCapabilities: { http: boolean } };
    };
    internals.starting = new Promise<void>((_resolve, reject) => { fail = reject; });
    internals.connection = { signal: new AbortController().signal };
    internals.capabilities = { mcpCapabilities: { http: true } };
    const rejected = expect(host.supportsHttpMcp()).rejects.toThrow('initialize failed');
    fail(new Error('initialize failed'));
    await rejected;
  });
  it('waits for ACP initialization even when a transport is already assigned', async () => {
    let complete!: () => void;
    const initializing = new Promise<void>(resolve => { complete = resolve; });
    const host = new DevinAcpHost('swe-2');
    const internals = host as unknown as {
      starting: Promise<void>; connection: { signal: AbortSignal };
      capabilities: { mcpCapabilities: { http: boolean } };
    };
    internals.starting = initializing;
    internals.connection = { signal: new AbortController().signal };
    internals.capabilities = { mcpCapabilities: { http: true } };
    let settled = false;
    const result = host.supportsHttpMcp().then(value => { settled = true; return value; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    complete();
    await expect(result).resolves.toBe(true);
  });
  it('launches exact dynamically discovered model tokens without a shell wrapper', () => {
    expect(buildDevinCliLaunchSpec('glm-5-2', 'C:\\Users\\KalioUser\\AppData\\Local\\devin\\cli\\bin\\devin.exe')).toEqual({
      command: 'C:\\Users\\KalioUser\\AppData\\Local\\devin\\cli\\bin\\devin.exe',
      args: ['--model', 'glm-5-2', 'acp'],
    });
    expect(buildDevinCliLaunchSpec('swe-2-high', 'devin.exe')).toEqual({
      command: 'devin.exe',
      args: ['--model', 'swe-2-high', 'acp'],
    });
    expect(() => buildDevinCliLaunchSpec('  ')).toThrow('model is required');
  });

  it('recognizes authenticated ACP support and returns the dynamic catalog state', () => {
    expect(parseDevinCliProbe('devin.exe', {
      version: { text: 'devin 3000.11.1 (build)', exitCode: 0 },
      authStatus: { text: 'Logged in (via Devin)', exitCode: 0 },
      acpHelp: { text: 'Usage: devin acp\nRun as an ACP agent', exitCode: 0 },
      modelCatalog: { models: ['glm-5.2', 'glm-5-2', 'swe-2-high'], status: 'ready', discoveredAt: 1, stale: false },
    })).toEqual({
      executable: 'devin.exe',
      version: '3000.11.1',
      authenticated: true,
      acp: true,
      models: ['glm-5.2', 'glm-5-2', 'swe-2-high'],
      modelCatalogStatus: 'ready',
      modelCatalogStale: false,
      modelCatalogDiscoveredAt: 1,
    });
  });

  it('does not report authentication when the auth probe exits with an error', () => {
    expect(parseDevinCliProbe('devin.exe', {
      version: { text: 'devin 3000.11.1 (build)', exitCode: 0 },
      authStatus: { text: 'Logged in\nPermissionDenied: rolling file appender', exitCode: 101 },
      acpHelp: { text: 'Usage: devin acp\nRun as an ACP agent', exitCode: 0 },
      modelCatalog: { models: ['glm-5-2', 'swe-2-high'], status: 'ready', discoveredAt: 1, stale: false },
    })).toMatchObject({ authenticated: false, acp: true, models: ['glm-5-2', 'swe-2-high'] });
  });

  it('preserves ACP structured tool input for the Kalio permission boundary', () => {
    let activity: unknown;
    const host = new DevinAcpHost('swe-2-high') as unknown as {
      sessions: Map<string, { active: { onToolActivity: (value: unknown) => void } }>;
      handleSessionUpdate: (params: SessionNotification) => void;
    };
    host.sessions.set('session-1', { active: { onToolActivity: (value) => { activity = value; } } });

    host.handleSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'functions.mcp_call_tool:1',
        name: 'mcp_call_tool',
        title: 'Calling fs_list from kalio-runtime',
        kind: 'execute',
        status: 'pending',
        rawInput: { server: 'kalio-runtime', tool: 'fs_list' },
        rawOutput: { error: 'Permission denied' },
        content: [{ type: 'content', content: { type: 'text', text: 'Permission denied' } }],
      },
    } as unknown as SessionNotification);

    expect(activity).toMatchObject({
      toolCallId: 'functions.mcp_call_tool:1',
      name: 'mcp_call_tool',
      rawInput: { server: 'kalio-runtime', tool: 'fs_list' },
      rawOutput: { error: 'Permission denied' },
      content: [{ type: 'content', content: { type: 'text', text: 'Permission denied' } }],
    });
  });
});
