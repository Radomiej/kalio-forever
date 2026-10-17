import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDevinCliConfig } from './devin-cli-config';

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, mkdir: vi.fn(actual.mkdir), mkdtemp: vi.fn(actual.mkdtemp), rm: vi.fn(actual.rm), writeFile: vi.fn(actual.writeFile) };
});

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.clearAllMocks();
  vi.mocked(mkdir).mockImplementation(actual.mkdir);
  vi.mocked(rm).mockImplementation(actual.rm);
  vi.mocked(writeFile).mockImplementation(actual.writeFile);
});
afterEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  for (const result of vi.mocked(mkdtemp).mock.results) {
    if (result.type === 'return') await actual.rm(await result.value, { recursive: true, force: true });
  }
});

describe('Devin CLI ephemeral config', () => {
  it('retains the standalone cleanup handle when rollback itself fails', async () => {
    const failure = new Error('mkdir fixture failure');
    vi.mocked(mkdir).mockRejectedValueOnce(failure);
    vi.mocked(rm).mockRejectedValueOnce(new Error('locked fixture'));
    const error: unknown = await createDevinCliConfig('swe-2', []).catch(error => error);
    expect(error).toBeInstanceOf(AggregateError);
    const retained = error as AggregateError & { config: { cleanup: () => Promise<void> } };
    expect(retained.errors[0]).toBe(failure);
    const directory = await vi.mocked(mkdtemp).mock.results[0].value;
    expect((await stat(directory)).isDirectory()).toBe(true);
    await retained.config.cleanup();
    await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes the allocated directory when preparation fails before returning a handle', async () => {
    const failure = new Error('mkdir fixture failure');
    vi.mocked(mkdir).mockRejectedValueOnce(failure);
    await expect(createDevinCliConfig('swe-2', [])).rejects.toBe(failure);
    const directory = await vi.mocked(mkdtemp).mock.results[0].value;
    await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('joins both writes before reporting failure or deleting the private directory', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const failure = new Error('write fixture failure');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(writeFile).mockRejectedValueOnce(failure).mockImplementationOnce(async (...args) => {
      await gate;
      await actual.writeFile(...args);
    });
    let settled = false;
    const creation = createDevinCliConfig('swe-2', []).catch(error => { settled = true; return error; });
    try {
      await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(2));
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(rm).not.toHaveBeenCalled();
    } finally {
      release();
      expect(await creation).toBe(failure);
    }
    const directory = await vi.mocked(mkdtemp).mock.results[0].value;
    await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('asks for enabled native categories without enabling disabled ones', async () => {
    const config = await createDevinCliConfig('swe-2', [], { filesystem: true, terminal: false, web: true, source: 'settings' });
    try {
      const parsed = JSON.parse(await readFile(config.path, 'utf8')) as { permissions: { ask: string[]; deny: string[] } };
      expect(parsed.permissions.deny).toEqual(['exec']);
      expect(parsed.permissions.ask).toEqual(['read', 'grep', 'glob', 'edit', 'write', 'webfetch', 'web_search']);
    } finally {
      await config.cleanup();
    }
  });
  it('denies automatic native reads in the private host configuration', async () => {
    const config = await createDevinCliConfig('swe-2', []);
    try {
      const parsed = JSON.parse(await readFile(config.path, 'utf8')) as { permissions?: { deny?: string[] } };
      expect(parsed.permissions?.deny).toEqual(expect.arrayContaining(['read', 'grep', 'glob', 'edit', 'write', 'exec']));
      expect(parsed.permissions?.deny).not.toContain('mcp__*');
      await config.suppressMcpServers(['foreign-server']);
      const rewritten = JSON.parse(await readFile(config.path, 'utf8')) as { permissions?: { deny?: string[] } };
      expect(rewritten.permissions).toEqual(parsed.permissions);
    } finally {
      await config.cleanup();
    }
  });
  it('serializes the scoped stdio bridge and cleans the temporary config', async () => {
    const config = await createDevinCliConfig('glm-5-2', [{
      name: 'kalio-runtime',
      command: process.execPath,
      args: ['kalio-mcp-bridge-stdio.js'],
      env: [
        { name: 'KALIO_MCP_BRIDGE_SESSION_ID', value: 'session-1' },
        { name: 'KALIO_MCP_BRIDGE_TOOL_NAMES', value: 'fs_list' },
      ],
    }]);
    try {
      const parsed = JSON.parse(await readFile(config.path, 'utf8')) as {
        agent?: { model?: string };
        read_config_from?: Record<string, boolean>;
        mcpServers?: Record<string, { transport?: string; command?: string; args?: string[]; env?: Record<string, string> }>;
      };
      expect(parsed.agent?.model).toBe('glm-5-2');
      expect(parsed.read_config_from).toEqual({
        cursor: false, windsurf: false, claude: false,
        copilot: false, opencode: false, zed: false,
      });
      expect(parsed.mcpServers?.['kalio-runtime']).toEqual({
        command: process.execPath,
        args: ['kalio-mcp-bridge-stdio.js'],
        env: {
          KALIO_MCP_BRIDGE_SESSION_ID: 'session-1',
          KALIO_MCP_BRIDGE_TOOL_NAMES: 'fs_list',
        },
      });
      expect(config.cwd).toContain('kalio-devin-acp-');
      expect(config.path).toBe(join(config.cwd, '.devin', 'config.local.json'));
      expect((await stat(join(config.cwd, '.git'))).isDirectory()).toBe(true);
      expect((await stat(join(config.cwd, '.git', 'HEAD'))).isFile()).toBe(true);
      expect(await readFile(join(config.cwd, '.devin', 'mcp_config.local.json'), 'utf8')).toContain('kalio-runtime');
    } finally {
      await config.cleanup();
    }
  });
});
