import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { AppSettingsService } from '../../database/app-settings.service';
import { AuditLogController } from './audit-log.controller';
import { AuditService } from './audit.service';

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
    );
    CREATE TABLE IF NOT EXISTS audit_log_archive (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      data TEXT,
      duration_ms INTEGER,
      chunk_count INTEGER,
      created_at INTEGER NOT NULL,
      archived_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
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
    controller = new AuditLogController(drizzleSvc, new AuditService(drizzleSvc, new AppSettingsService(drizzleSvc)));

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
    await drizzleSvc.db.insert(schema.auditLogArchive).values([
      {
        id: 'arch-1',
        sessionId: 'sess-1',
        type: 'tool_result' as const,
        label: 'archived result',
        createdAt: new Date(500),
        archivedAt: new Date(4000),
      },
      {
        id: 'arch-2',
        sessionId: 'sess-3',
        type: 'llm_response' as const,
        label: 'archived response',
        data: { model: 'mimo-v2.5-pro' } as Record<string, unknown>,
        createdAt: new Date(2500),
        archivedAt: new Date(4000),
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

    it('returns merged hot and archive entries when source=all', async () => {
      const rows = await controller.list(undefined, undefined, undefined, undefined, undefined, 'all');

      expect(rows.map((row) => row.id)).toEqual(['arch-1', 'al-1', 'al-2', 'arch-2', 'al-3']);
    });

    it('returns only archived entries when source=archive', async () => {
      const rows = await controller.list(undefined, undefined, undefined, undefined, undefined, 'archive');

      expect(rows.map((row) => row.id)).toEqual(['arch-1', 'arch-2']);
      expect(rows[1].data).toEqual({ model: 'mimo-v2.5-pro' });
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

    it('applies session filter', async () => {
      const rows = await controller.list(undefined, undefined, 'sess-1', undefined, undefined, 'all');
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.sessionId === 'sess-1')).toBe(true);
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
      const rows = await controller.list(undefined, undefined, undefined, '1500', undefined, 'all');
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.createdAt >= 1500)).toBe(true);
    });

    it('applies until filter', async () => {
      const rows = await controller.list(undefined, undefined, undefined, undefined, '2500', 'all');
      expect(rows).toHaveLength(4);
      expect(rows.every((r) => r.createdAt <= 2500)).toBe(true);
    });

    it('combines since and until filters', async () => {
      const rows = await controller.list(undefined, undefined, undefined, '1500', '2500', 'all');
      expect(rows.map((row) => row.id)).toEqual(['al-2', 'arch-2']);
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

    it('clamps non-positive limits to one row', async () => {
      const rows = await controller.list('-100');
      expect(rows).toHaveLength(1);
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

      const after = await controller.list(undefined, undefined, undefined, undefined, undefined, 'all');
      expect(after).toHaveLength(0);
    });
  });

  describe('retention()', () => {
    it('returns hot audit storage status', async () => {
      const status = await controller.retention();

      expect(status.hotRows).toBe(3);
      expect(status.archivedRows).toBe(2);
      expect(status.maxHotRows).toBe(50_000);
      expect(status.maxArchivedRows).toBe(250_000);
      expect(status.retentionDays).toBe(30);
      expect(status.archiveRetentionDays).toBe(30);
      expect(status.pruneEveryWrites).toBe(100);
      expect(status.pruneIntervalHours).toBe(24);
      expect(status.lastRetentionRunAt).toBeNull();
      expect(status.nextRetentionRunAt).toBeNull();
      expect(status.oldestHotEntryAt).toBe(1000);
      expect(status.newestHotEntryAt).toBe(3000);
      expect(status.oldestArchiveEntryAt).toBe(500);
      expect(status.newestArchiveEntryAt).toBe(2500);
      expect(status.coldStorageEnabled).toBe(true);
      expect(status.coldStorageMode).toBe('sqlite_table');
    });
  });

  describe('runRetention()', () => {
    it('rejects without confirm=true', () => {
      expect(() => controller.runRetention()).toThrow();
      expect(() => controller.runRetention('false')).toThrow();
    });

    it('runs retention and returns updated status when confirmed', async () => {
      const status = await controller.runRetention('true');

      expect(status.hotRows).toBe(0);
      expect(status.archivedRows).toBe(3);
      expect(status.coldStorageEnabled).toBe(true);
    });
  });

  describe('updateRetention()', () => {
    it('persists editable audit retention policy', async () => {
      const policy = await controller.updateRetention({
        retentionDays: 7,
        archiveRetentionDays: 31,
        pruneEveryWrites: 25,
        pruneIntervalHours: 12,
      });

      expect(policy).toMatchObject({
        retentionDays: 7,
        archiveRetentionDays: 31,
        pruneEveryWrites: 25,
        pruneIntervalHours: 12,
      });

      const status = await controller.retention();
      expect(status.retentionDays).toBe(7);
      expect(status.archiveRetentionDays).toBe(31);
      expect(status.pruneEveryWrites).toBe(25);
      expect(status.pruneIntervalHours).toBe(12);
    });
  });
});
