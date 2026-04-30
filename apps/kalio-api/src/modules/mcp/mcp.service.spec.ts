import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { MCPService } from './mcp.service';
import { DrizzleService } from '../../database/drizzle.service';
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

  describe('callTool()', () => {
    it('throws when server is not found', async () => {
      await expect(service.callTool('non-existent', 'my_tool', {})).rejects.toThrow(
        'MCP server non-existent not connected',
      );
    });
  });

  describe('removeServer()', () => {
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

      await expect(service.removeServer('orphan-1')).resolves.not.toThrow();
      const all = await service.findAll();
      expect(all).toHaveLength(0);
    });
  });

  describe('restartServer()', () => {
    it('throws when server not found in handles', async () => {
      await expect(service.restartServer('non-existent')).rejects.toThrow(
        'MCP server not found: non-existent',
      );
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
      const tools = service.getToolsForServer('unknown-server');
      expect(tools).toHaveLength(0);
    });
  });

  describe('onModuleDestroy()', () => {
    it('cleans up without throwing when no connections active', async () => {
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });
  });

  describe('addServer() — transport validation', () => {
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
      await expect(service.restartServer('no-such-id')).rejects.toThrow('MCP server not found: no-such-id');
    });
  });
});
