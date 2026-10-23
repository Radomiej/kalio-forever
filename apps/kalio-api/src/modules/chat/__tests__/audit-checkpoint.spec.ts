import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DrizzleService } from '../../../database/drizzle.service';
import { auditLog } from '../../../database/schema';
import { AuditService } from '../audit.service';

describe('required architecture checkpoints', () => {
  let sqlite: Database.Database;
  let service: AuditService;
  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`CREATE TABLE audit_log (
      id TEXT PRIMARY KEY, session_id TEXT, type TEXT NOT NULL,
      label TEXT NOT NULL, data TEXT, duration_ms INTEGER,
      chunk_count INTEGER, created_at INTEGER NOT NULL
    )`);
    service = new AuditService({ db: drizzle(sqlite) } as unknown as DrizzleService);
  });
  afterEach(() => sqlite.close());

  const decision = {
    sessionId: 'parent', type: 'architecture_event' as const,
    label: 'architecture_event:router_decision:judge',
    data: { selectedEdgeId: 'continue', autoRoutingVisit: 1 },
  };

  it('persists one immutable decision when replayed with the same checkpoint key', async () => {
    await service.logRequired('run:judge:1', decision);
    await service.logRequired('run:judge:1', decision);
    const rows = drizzle(sqlite).select().from(auditLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'run:judge:1', sessionId: 'parent', data: decision.data });
  });

  it('rejects a conflicting verdict and preserves the original decision', async () => {
    await service.logRequired('run:judge:1', decision);
    await expect(service.logRequired('run:judge:1', {
      ...decision, data: { selectedEdgeId: 'finish', autoRoutingVisit: 1 },
    })).rejects.toThrow('different decision');
    expect(drizzle(sqlite).select().from(auditLog).all()[0]?.data).toEqual(decision.data);
  });

  it('propagates storage failure instead of acknowledging an unwritten checkpoint', async () => {
    sqlite.exec('DROP TABLE audit_log');
    await expect(service.logRequired('run:judge:1', decision)).rejects.toThrow();
  });
});
