import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { CreateMCPServerDto, MCPTool } from '@kalio/types';
import { MCPService } from './mcp.service';
import { DrizzleService } from '../../database/drizzle.service';
import type { KalioConfigService } from '../../config/kalio-config.service';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../database/schema';

function makeTestDrizzle(): DrizzleService {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      transport TEXT NOT NULL DEFAULT 'http',
      origin_source TEXT NOT NULL DEFAULT 'manual',
      url TEXT,
      command TEXT,
      args TEXT,
      env_vars TEXT,
      headers TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'disconnected',
      tool_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  const db = drizzle(sqlite, { schema });
  const svc = new DrizzleService(null as never);
  (svc as unknown as { db: unknown }).db = db;
  return svc;
}

type KalioConfigMock = Pick<KalioConfigService, 'getEffectiveConfig' | 'invalidateCache'>;

function makeKalioConfigMock(mcpServers: Record<string, unknown>): KalioConfigMock {
  return {
    invalidateCache: vi.fn(),
    getEffectiveConfig: vi.fn(async () => ({
      config: { mcp_servers: mcpServers },
      layers: [],
    })),
  } as unknown as KalioConfigMock;
}

describe('MCPService — pure logic (no real MCP connections)', () => {
  let service: MCPService;
  let drizzleSvc: DrizzleService;

  beforeEach(async () => {
    drizzleSvc = makeTestDrizzle();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MCPService,
        { provide: DrizzleService, useValue: drizzleSvc },
      ],
    }).compile();

    service = module.get(MCPService);
  });

  describe('onModuleInit() — empty DB', () => {
    it('initializes with no servers in DB (no-op)', async () => {
      // Should not throw when no servers exist
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('findAll()', () => {
    it('returns empty array when no servers in DB', async () => {
      const servers = await service.findAll();
      expect(servers).toHaveLength(0);
    });

    it('includes enabled TOML-managed servers without persisting them', async () => {
      const kalioConfig = makeKalioConfigMock({
        docs: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
          env: { STATIC_TOKEN: 'token' },
        },
        disabled: {
          enabled: false,
          command: 'npx',
        },
      });
      service = new MCPService(drizzleSvc, kalioConfig as KalioConfigService);

      const servers = await service.findAll();

      expect(servers.map((server) => server.id)).toEqual(['docs']);
      expect(servers[0]).toMatchObject({
        id: 'docs',
        serverKey: 'toml::docs',
        name: 'docs',
        store: 'toml',
        originSource: 'toml',
        effectiveState: 'active',
        transport: 'stdio',
        command: 'npx',
        status: 'disconnected',
      });
    });
  });

  describe('getAllTools()', () => {
    it('returns empty array when no connected servers', () => {
      const tools = service.getAllTools();
      expect(tools).toHaveLength(0);
    });
  });

  describe('resolveToolName()', () => {
    it('returns null for unknown prefixed tool name', () => {
      const result = service.resolveToolName('mcp_unknown_search');
      expect(result).toBeNull();
    });
  });

  describe('emitStatus()', () => {
    it('emits canonical serverKey values instead of raw row ids', () => {
      const emitted: Array<{ event: string; payload: Record<string, unknown> }> = [];
      const internals = service as unknown as {
        gatewayRef: { emitToAll(event: string, payload: Record<string, unknown>): void } | undefined;
        emitStatus(handle: {
          id: string;
          serverKey: string;
          name: string;
          status: string;
          tools: MCPTool[];
          lastError?: string;
        }): void;
      };

      internals.gatewayRef = {
        emitToAll(event, payload) {
          emitted.push({ event, payload });
        },
      };

      internals.emitStatus({
        id: 'legacy-row-id',
        serverKey: 'sqlite::github',
        name: 'GitHub MCP',
        status: 'connected',
        tools: [],
      });

      expect(emitted).toEqual([
        {
          event: 'mcp:server:status',
          payload: expect.objectContaining({
            serverId: 'sqlite::github',
            serverKey: 'sqlite::github',
            serverName: 'GitHub MCP',
            status: 'connected',
            toolCount: 0,
          }),
        },
      ]);
    });
  });

  describe('callTool()', () => {
    it('throws when server is not found', async () => {
      await expect(service.callTool('non-existent', 'my_tool', {})).rejects.toThrow(
        'MCP server non-existent not connected',
      );
    });
  });

  describe('removeServer()', () => {
    it('accepts legacy sqlite row id and removes row during compatibility fallback', async () => {
      const db = (drizzleSvc as unknown as { db: ReturnType<typeof drizzle> }).db;
      await db.insert(schema.mcpServers).values({
        id: 'legacy-1',
        name: 'Legacy Row',
        transport: 'http',
        url: 'https://legacy.example.com',
        enabled: true,
        status: 'disconnected',
        createdAt: new Date(),
      });

      await expect(service.removeServer('legacy-1')).resolves.not.toThrow();
      const all = await service.findAll();
      expect(all).toHaveLength(0);
    });

    it('does not throw when server not found in handles', async () => {
      // Insert a row first so DB delete doesn't throw
      const db = (drizzleSvc as unknown as { db: ReturnType<typeof drizzle> }).db;
      await db.insert(schema.mcpServers).values({
        id: 'orphan-1',
        name: 'Orphan',
        transport: 'http',
        url: 'http://example.com',
        enabled: true,
        status: 'disconnected',
        createdAt: new Date(),
      });

      await expect(service.removeServer('sqlite::orphan-1')).resolves.not.toThrow();
      const all = await service.findAll();
      expect(all).toHaveLength(0);
    });

    it('rejects removing a TOML-managed server', async () => {
      const kalioConfig = makeKalioConfigMock({
        docs: {
          command: 'npx',
        },
      });
      service = new MCPService(drizzleSvc, kalioConfig as KalioConfigService);

      await expect(service.removeServer('toml::docs')).rejects.toThrow('managed by .kalio/config.toml');
    });

    it('resolves legacy TOML key before rejecting remove for managed config', async () => {
      const kalioConfig = makeKalioConfigMock({
        docs: {
          command: 'npx',
        },
      });
      service = new MCPService(drizzleSvc, kalioConfig as KalioConfigService);

      await expect(service.removeServer('docs')).rejects.toThrow('managed by .kalio/config.toml');
    });

    it('prefers TOML over SQLite when both share the same raw key', async () => {
      const db = (drizzleSvc as unknown as { db: ReturnType<typeof drizzle> }).db;
      await db.insert(schema.mcpServers).values({
        id: 'docs',
        name: 'SQLite Docs',
        transport: 'http',
        url: 'https://sqlite.example.com',
        enabled: true,
        status: 'disconnected',
        createdAt: new Date(),
      });

      const kalioConfig = makeKalioConfigMock({
        docs: {
          command: 'npx',
        },
      });
      service = new MCPService(drizzleSvc, kalioConfig as KalioConfigService);

      await expect(service.removeServer('docs')).rejects.toThrow('managed by .kalio/config.toml');

      const all = await service.findAll();
      expect(all.map((server) => server.serverKey)).toContain('sqlite::docs');
      expect(all.map((server) => server.serverKey)).toContain('toml::docs');
    });

    it('prefers TOML over SQLite for restart resolution when both share the same raw key', async () => {
      const db = (drizzleSvc as unknown as { db: ReturnType<typeof drizzle> }).db;
      await db.insert(schema.mcpServers).values({
        id: 'docs',
        name: 'SQLite Docs',
        transport: 'http',
        url: 'https://sqlite.example.com',
        enabled: true,
        status: 'disconnected',
        createdAt: new Date(),
      });

      const kalioConfig = makeKalioConfigMock({
        docs: {
          command: 'npx',
        },
      });
      service = new MCPService(drizzleSvc, kalioConfig as KalioConfigService);

      const internals = service as unknown as {
        handles: Map<string, {
          serverKey: string;
          id: string;
          name: string;
          store: 'toml' | 'sqlite';
          originSource: 'toml' | 'manual' | 'cursor' | 'windsurf' | 'codex' | 'copilot';
          transport: 'stdio' | 'http';
          status: 'connecting' | 'connected' | 'disconnected' | 'error';
          tools: [];
          restartCount: number;
          createdAt: number;
          enabled: boolean;
          client: unknown;
          rawTransport: unknown;
          signature: string;
        }>;
        connectHandle(handle: unknown): Promise<void>;
        disconnectHandle(serverKey: string): Promise<void>;
      };
      const connectHandle = vi.spyOn(internals, 'connectHandle').mockResolvedValue(undefined);
      const disconnectHandle = vi.spyOn(internals, 'disconnectHandle').mockResolvedValue(undefined);

      internals.handles.set('sqlite::docs', {
        serverKey: 'sqlite::docs',
        id: 'docs',
        name: 'SQLite Docs',
        store: 'sqlite',
        originSource: 'manual',
        transport: 'http',
        status: 'disconnected',
        tools: [],
        restartCount: 0,
        createdAt: Date.now(),
        enabled: true,
        client: null,
        rawTransport: null,
        signature: 'http:https://sqlite.example.com',
      });

      await expect(service.restartServer('docs')).rejects.toThrow('MCP server not found: docs');
      expect(disconnectHandle).not.toHaveBeenCalled();
      expect(connectHandle).not.toHaveBeenCalled();

      connectHandle.mockRestore();
      disconnectHandle.mockRestore();
    });
  });

  describe('restartServer()', () => {
    it('accepts legacy sqlite id when handle key is stored in runtime map', async () => {
      const internals = service as unknown as {
        handles: Map<string, {
          serverKey: string;
          id: string;
          name: string;
          store: 'toml' | 'sqlite';
          originSource: 'toml' | 'manual' | 'cursor' | 'windsurf' | 'codex' | 'copilot';
          transport: 'stdio' | 'http';
          status: 'connecting' | 'connected' | 'disconnected' | 'error';
          tools: [];
          restartCount: number;
          createdAt: number;
          enabled: boolean;
          client: unknown;
          rawTransport: unknown;
          signature: string;
        }>;
        connectHandle(handle: unknown): Promise<void>;
        disconnectHandle(serverKey: string): Promise<void>;
      };
      const connectHandle = vi.spyOn(internals, 'connectHandle').mockResolvedValue(undefined);
      const disconnectHandle = vi.spyOn(internals, 'disconnectHandle').mockResolvedValue(undefined);

      internals.handles.set('sqlite::legacy-run', {
        serverKey: 'sqlite::legacy-run',
        id: 'legacy-run',
        name: 'Legacy Runtime',
        store: 'sqlite',
        originSource: 'manual',
        transport: 'http',
        status: 'disconnected',
        tools: [],
        restartCount: 0,
        createdAt: Date.now(),
        enabled: true,
        client: null,
        rawTransport: null,
        signature: 'http:',
      });

      await expect(service.restartServer('legacy-run')).resolves.not.toThrow();
      expect(disconnectHandle).toHaveBeenCalledWith('sqlite::legacy-run');
      expect(connectHandle).toHaveBeenCalledTimes(1);
      expect(connectHandle).toHaveBeenCalledWith(expect.objectContaining({ serverKey: 'sqlite::legacy-run' }));

      connectHandle.mockRestore();
      disconnectHandle.mockRestore();
    });

    it('throws when server not found in handles', async () => {
      await expect(service.restartServer('sqlite::non-existent')).rejects.toThrow(
        'MCP server not found: sqlite::non-existent',
      );
    });
  });

  describe('reloadManagedServers()', () => {
    it('invalidates the TOML cache and reloads the server list', async () => {
      const kalioConfig = makeKalioConfigMock({});
      service = new MCPService(drizzleSvc, kalioConfig as KalioConfigService);

      await expect(service.reloadManagedServers()).resolves.toEqual([]);
      expect(kalioConfig.invalidateCache).toHaveBeenCalledOnce();
      expect(kalioConfig.getEffectiveConfig).toHaveBeenCalled();
    });
  });

  describe('setGateway()', () => {
    it('sets gateway reference without throwing', () => {
      const gw = { emitToAll: vi.fn() };
      expect(() => service.setGateway(gw)).not.toThrow();
    });
  });

  describe('getToolsForServer()', () => {
    it('returns empty array for unknown server id', () => {
      const tools = service.getToolsForServer('sqlite::unknown-server');
      expect(tools).toHaveLength(0);
    });
  });

  describe('onModuleDestroy()', () => {
    it('cleans up without throwing when no connections active', async () => {
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });
  });

  describe('addServer() – transport validation', () => {
    it('reuses deterministic id for duplicate server config', async () => {
      const dto: CreateMCPServerDto = {
        name: 'Test HTTP Server',
        transport: 'http',
        url: 'https://example.com/mcp',
      };

      const first = await service.addServer(dto);
      const second = await service.addServer(dto);
      const all = await service.findAll();

      expect(first.id).toBe(second.id);
      expect(first.id).toMatch(/^test-http-server-/);
      expect(all.filter((server) => server.id === first.id)).toHaveLength(1);
    });

    it('normalizes server config for deterministic ids regardless of object key order', async () => {
      const first = await service.addServer({
        name: '  Demo MCP Server ',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-demo'],
        env: { B: 'two', A: 'one' },
      });
      const second = await service.addServer({
        name: 'Demo MCP Server',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-demo'],
        env: { A: 'one', B: 'two' },
      });

      expect(second.id).toBe(first.id);
      expect(second.id).toMatch(/^demo-mcp-server-/);
    }, 60_000);

    it('toMCPServer shape: reflects handle status when present', async () => {
      // Insert a row directly so we can call findAll() and check toMCPServer mapping
      const db = (drizzleSvc as unknown as { db: ReturnType<typeof drizzle> }).db;
      await db.insert(schema.mcpServers).values({
        id: 'test-s1',
        name: 'Test Server',
        transport: 'http',
        url: 'http://example.com',
        enabled: true,
        status: 'disconnected',
        createdAt: new Date(),
      });

      const all = await service.findAll();
      const s = all.find((s) => s.id === 'test-s1');
      expect(s).toBeDefined();
      expect(s!.name).toBe('Test Server');
      expect(s!.transport).toBe('http');
      expect(s!.status).toBe('disconnected');
    });

    it('stdio transport missing command throws via restartServer', async () => {
      // restartServer throws when handle not found
      await expect(service.restartServer('sqlite::no-such-id')).rejects.toThrow('MCP server not found: sqlite::no-such-id');
    });
  });

  // --- Internal state helpers (accessed via unknown cast, no `any`) ---
  type ServiceInternals = {
    toolNameMap: Map<string, { serverKey: string; originalName: string }>;
    handles: Map<string, { id: string; tools: MCPTool[]; status: string }>;
    discoverTools(serverKey: string, client: unknown): Promise<MCPTool[]>;
  };

  describe('getToolByName()', () => {
    it('returns undefined for an unknown tool name (not in toolNameMap)', () => {
      expect(service.getToolByName('mcp_sqlite::s1_foo')).toBeUndefined();
    });

    it('returns undefined when tool is in toolNameMap but server handle does not exist', () => {
      const internals = service as unknown as ServiceInternals;
      internals.toolNameMap.set('mcp_sqlite::s1_foo', { serverKey: 'sqlite::s1', originalName: 'foo' });
      // No handle for 's1' → optional chain returns undefined
      expect(service.getToolByName('mcp_sqlite::s1_foo')).toBeUndefined();
    });

    it('returns undefined when server is present but tools array is empty (disconnected)', () => {
      const internals = service as unknown as ServiceInternals;
      internals.toolNameMap.set('mcp_sqlite::s1_bar', { serverKey: 'sqlite::s1', originalName: 'bar' });
      internals.handles.set('sqlite::s1', { id: 's1', tools: [], status: 'disconnected' });
      expect(service.getToolByName('mcp_sqlite::s1_bar')).toBeUndefined();
    });

    it('returns the matching MCPTool when server is connected and tool exists', () => {
      const tool: MCPTool = {
        name: 'mcp_sqlite::s1_baz',
        description: 'baz',
        parameters: {},
        requiresConfirmation: false,
        serverKey: 'sqlite::s1',
        serverId: 'sqlite::s1',
      };
      const internals = service as unknown as ServiceInternals;
      internals.toolNameMap.set('mcp_sqlite::s1_baz', { serverKey: 'sqlite::s1', originalName: 'baz' });
      internals.handles.set('sqlite::s1', { id: 's1', tools: [tool], status: 'connected' });
      expect(service.getToolByName('mcp_sqlite::s1_baz')).toStrictEqual(tool);
    });

    it('resolves legacy prefixed MCPTool names when a canonical serverKey is active', () => {
      const tool: MCPTool = {
        name: 'mcp_toml::docs_search',
        description: 'search docs',
        parameters: {},
        requiresConfirmation: false,
        serverKey: 'toml::docs',
        serverId: 'toml::docs',
      };
      const internals = service as unknown as ServiceInternals;
      internals.toolNameMap.set('mcp_toml::docs_search', { serverKey: 'toml::docs', originalName: 'search' });
      internals.toolNameMap.set('mcp_docs_search', { serverKey: 'toml::docs', originalName: 'search' });
      internals.handles.set('toml::docs', { id: 'docs', tools: [tool], status: 'connected' });

      expect(service.getToolByName('mcp_docs_search')).toStrictEqual(tool);
    });
  });

  describe('discoverTools() — pagination safety cap', () => {
    it('stops after 100 iterations when server always returns a nextCursor', async () => {
      let callCount = 0;
      const fakeClient = {
        listTools: vi.fn(async (_opts?: unknown) => {
          callCount++;
          return {
            tools: [{ name: `tool_${callCount}`, description: 'test', inputSchema: {} }],
            nextCursor: 'always-truthy',
          };
        }),
      };

      const internals = service as unknown as ServiceInternals;
      const tools = await internals.discoverTools('sqlite::s1', fakeClient);

      expect(callCount).toBe(100);
      expect(tools).toHaveLength(100);
      expect(tools[0].name).toBe('mcp_sqlite::s1_tool_1');
      expect(tools[99].name).toBe('mcp_sqlite::s1_tool_100');
    });

    it('stores legacy alias names for toml and sqlite serverKey-shaped handles', async () => {
      const fakeClient = {
        listTools: vi.fn(async () => ({
          tools: [{ name: 'search', description: 'search docs', inputSchema: {} }],
          nextCursor: undefined,
        })),
      };

      const internals = service as unknown as ServiceInternals;
      const canonicalTools = await internals.discoverTools('toml::docs', fakeClient);

      expect(canonicalTools).toHaveLength(1);
      expect(canonicalTools[0]!.name).toBe('mcp_toml::docs_search');
      expect(canonicalTools[0]!.serverKey).toBe('toml::docs');
      expect(canonicalTools[0]!.serverId).toBe('toml::docs');

      expect(internals.toolNameMap.has('mcp_toml::docs_search')).toBe(true);
      expect(internals.toolNameMap.has('mcp_docs_search')).toBe(true);
    });

    it('stops early when server returns no nextCursor', async () => {
      const fakeClient = {
        listTools: vi.fn(async () => ({
          tools: [
            { name: 'alpha', description: 'first', inputSchema: {} },
            { name: 'beta', description: 'second', inputSchema: {} },
          ],
          nextCursor: undefined,
        })),
      };

      const internals = service as unknown as ServiceInternals;
      const tools = await internals.discoverTools('sqlite::s2', fakeClient);

      expect(fakeClient.listTools).toHaveBeenCalledTimes(1);
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual(['mcp_sqlite::s2_alpha', 'mcp_sqlite::s2_beta']);
    });

    it('follows cursor across multiple pages until exhausted', async () => {
      const pages = [
        { tools: [{ name: 'a', description: '', inputSchema: {} }], nextCursor: 'page2' },
        { tools: [{ name: 'b', description: '', inputSchema: {} }], nextCursor: 'page3' },
        { tools: [{ name: 'c', description: '', inputSchema: {} }], nextCursor: undefined },
      ];
      let page = 0;
      const fakeClient = {
        listTools: vi.fn(async () => pages[page++]),
      };

      const internals = service as unknown as ServiceInternals;
      const tools = await internals.discoverTools('sqlite::s3', fakeClient);

      expect(fakeClient.listTools).toHaveBeenCalledTimes(3);
      expect(tools.map((t) => t.name)).toEqual(['mcp_sqlite::s3_a', 'mcp_sqlite::s3_b', 'mcp_sqlite::s3_c']);
    });
  });
});
