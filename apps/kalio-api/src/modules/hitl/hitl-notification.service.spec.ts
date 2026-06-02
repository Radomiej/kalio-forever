import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { HitlNotificationService } from './hitl-notification.service';
import type { HitlConfigService } from './hitl-config.service';

function makeTestDrizzle(): DrizzleService {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      data TEXT,
      duration_ms INTEGER,
      chunk_count INTEGER,
      created_at INTEGER NOT NULL
    );
  `);
  const db = drizzle(sqlite, { schema });

  const drizzleSvc = new DrizzleService(null as never);
  (drizzleSvc as unknown as { db: typeof db }).db = db;
  return drizzleSvc;
}

describe('HitlNotificationService', () => {
  let config: { getConfig: ReturnType<typeof vi.fn> };
  let relay: { broadcast: ReturnType<typeof vi.fn> };
  let drizzleService: DrizzleService;
  let service: HitlNotificationService;

  beforeEach(() => {
    config = {
      getConfig: vi.fn().mockResolvedValue({
        mode: 'manual',
        autoPersonaId: null,
        unattendedFallback: 'pause',
        representativePersonaId: null,
        notificationChannel: 'none',
        externalPolicyEnabled: false,
        externalPolicyPersonaId: null,
      }),
    };
    relay = {
      broadcast: vi.fn().mockResolvedValue(true),
    };
    drizzleService = makeTestDrizzle();
    service = new HitlNotificationService(
      config as unknown as HitlConfigService,
      drizzleService,
      relay as never,
    );
  });

  it('logs approval request events without sending when notification channel is none', async () => {
    await service.notifyApprovalRequested({
      requestId: 'req-1',
      timeoutMs: 600_000,
      request: {
        kind: 'tool',
        sessionId: 'sess-1',
        name: 'vfs_write',
        args: { path: 'README.md' },
        toolCallId: 'call-1',
      },
    });

    expect(relay.broadcast).not.toHaveBeenCalled();
    const rows = await drizzleService.db.select().from(schema.auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sessionId: 'sess-1',
      type: 'external_hitl',
      label: 'HITL approval requested: vfs_write',
    });
    expect(rows[0].data).toMatchObject({
      domain: 'hitl',
      approvalKind: 'tool',
      approvalId: 'req-1',
      eventType: 'hitl_approval_requested',
      requestId: 'req-1',
      channel: 'none',
      delivered: false,
      request: expect.objectContaining({ name: 'vfs_write', toolCallId: 'call-1' }),
    });
  });

  it('broadcasts a schema-based Telegram approval prompt when configured', async () => {
    config.getConfig.mockResolvedValue({
      mode: 'manual',
      autoPersonaId: null,
      unattendedFallback: 'representative',
      representativePersonaId: 'delegate',
      notificationChannel: 'telegram',
      externalPolicyEnabled: false,
      externalPolicyPersonaId: null,
    });

    await service.notifyApprovalRequested({
      requestId: 'req-telegram',
      timeoutMs: 600_000,
      request: {
        kind: 'tool',
        sessionId: 'sess-telegram',
        name: 'run_cli_agent',
        args: {},
      },
    });

    expect(relay.broadcast).toHaveBeenCalledWith(expect.stringContaining('/approve req-telegram <reason>'));
    const rows = await drizzleService.db.select().from(schema.auditLog);
    expect(rows[0].data).toMatchObject({
      channel: 'telegram',
      delivered: true,
    });
  });

  it('parses concierge approval replies into a structured schema', () => {
    expect(service.parseApprovalReply('approve req-123 safe bounded write')).toEqual({
      decision: 'approve',
      requestId: 'req-123',
      reason: 'safe bounded write',
    });
    expect(service.parseApprovalReply('reject req-123 outside scope')).toEqual({
      decision: 'reject',
      requestId: 'req-123',
      reason: 'outside scope',
    });
    expect(service.parseApprovalReply('maybe later')).toEqual({ decision: 'unknown' });
  });

  it('logs approval lifecycle events with the same request id contract', async () => {
    await service.logApprovalLifecycle({
      eventType: 'hitl_approval_confirmed',
      requestId: 'req-life',
      source: 'manual',
      request: {
        kind: 'tool',
        sessionId: 'sess-life',
        name: 'vfs_write',
        args: { path: 'README.md' },
        toolCallId: 'call-life',
      },
    });

    const rows = await drizzleService.db.select().from(schema.auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sessionId: 'sess-life',
      type: 'external_hitl',
      label: 'HITL approval confirmed: vfs_write',
    });
    expect(rows[0].data).toMatchObject({
      eventType: 'hitl_approval_confirmed',
      requestId: 'req-life',
      source: 'manual',
      request: expect.objectContaining({
        name: 'vfs_write',
        toolCallId: 'call-life',
      }),
    });
  });
});
