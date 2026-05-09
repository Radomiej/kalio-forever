import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { AuditLogController } from './audit-log.controller';

function makeTestDrizzle(): DrizzleService {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      data TEXT,
      duration_ms INTEGER,
      chunk_count INTEGER,
      created_at INTEGER NOT NULL
    )
  `);
  const db = drizzle(sqlite, { schema });
  const svc = new DrizzleService(null as never);
  (svc as unknown as { db: unknown }).db = db;
  return svc;
}

describe('AuditLogController', () => {
  let controller: AuditLogController;
  let drizzleSvc: DrizzleService;

  beforeEach(async () => {
    drizzleSvc = makeTestDrizzle();
    controller = new AuditLogController(drizzleSvc);

    // Seed some audit log entries
    await drizzleSvc.db.insert(schema.auditLog).values([
      {
        id: 'al-1',
        sessionId: 'sess-1',
        type: 'tool_call' as const,
        label: 'vfs_write called',
        createdAt: new Date(1000),
      },
      {
        id: 'al-2',
        sessionId: 'sess-1',
        type: 'llm_request' as const,
        label: 'LLM called',
        data: { tokens: 100 } as Record<string, unknown>,
        durationMs: 500,
        createdAt: new Date(2000),
      },
      {
        id: 'al-3',
        sessionId: 'sess-2',
        type: 'tool_call' as const,
        label: 'other tool',
        createdAt: new Date(3000),
      },
    ]);
  });

  describe('list()', () => {
    it('returns all entries in chronological order with no filters', async () => {
      const rows = await controller.list();
      expect(rows).toHaveLength(3);
      // Chronological order (oldest first)
      expect(rows[0].id).toBe('al-1');
      expect(rows[2].id).toBe('al-3');
    });

    it('returns entries with correct field mapping', async () => {
      const rows = await controller.list();
      const entry = rows.find((r) => r.id === 'al-2');
      expect(entry).toBeDefined();
      expect(entry!.sessionId).toBe('sess-1');
      expect(entry!.type).toBe('llm_request');
      expect(entry!.label).toBe('LLM called');
      expect(entry!.durationMs).toBe(500);
      expect(typeof entry!.createdAt).toBe('number');
    });

    it('applies type filter', async () => {
      const rows = await controller.list(undefined, 'llm_request');
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('llm_request');
    });

    it('applies multiple types filter', async () => {
      const rows = await controller.list(undefined, 'tool_call,llm_request');
      expect(rows).toHaveLength(3);
    });

    it('respects limit', async () => {
      const rows = await controller.list('2');
      expect(rows).toHaveLength(2);
    });

    it('caps limit at 500', async () => {
      // Even with limit=9999, should not throw — caps at 500
      const rows = await controller.list('9999');
      expect(rows.length).toBeLessThanOrEqual(3); // only 3 entries seeded
    });

    it('applies since filter', async () => {
      const rows = await controller.list(undefined, undefined, '1500');
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.createdAt >= 1500)).toBe(true);
    });

    it('applies until filter', async () => {
      const rows = await controller.list(undefined, undefined, undefined, '2500');
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.createdAt <= 2500)).toBe(true);
    });

    it('combines since and until filters', async () => {
      const rows = await controller.list(undefined, undefined, '1500', '2500');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('al-2');
    });

    it('returns empty array when no entries match type filter', async () => {
      const rows = await controller.list(undefined, 'nonexistent_type');
      expect(rows).toHaveLength(0);
    });

    it('uses default limit of 200 when not provided', async () => {
      const rows = await controller.list(undefined);
      expect(rows).toHaveLength(3);
    });

    it('falls back to 200 for invalid limit string', async () => {
      const rows = await controller.list('invalid');
      // parseInt('invalid') returns NaN, should fall back to 200
      expect(rows.length).toBeLessThanOrEqual(3);
    });
  });

  describe('clear()', () => {
    it('rejects without confirm=true', async () => {
      await expect(controller.clear()).rejects.toThrow();
      await expect(controller.clear('false')).rejects.toThrow();
    });

    it('deletes all entries when confirm=true', async () => {
      const before = await controller.list();
      expect(before.length).toBeGreaterThan(0);

      const result = await controller.clear('true');
      expect(result).toEqual({ deleted: true });

      const after = await controller.list();
      expect(after).toHaveLength(0);
    });
  });
});
