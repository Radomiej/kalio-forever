import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { eq, lt, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { AuditRetentionPolicy, AuditRetentionStatus } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { auditLog, auditLogArchive } from '../../database/schema';
import { AppSettingsService } from '../../database/app-settings.service';
import {
  type AuditLogEntry,
  type AuditLogInput,
  type AuditLogQuery,
  type RawAuditLogEntry,
  buildAuditWhereClause,
  defaultRetentionPolicy,
  LAST_RETENTION_RUN_KEY,
  normalizePolicyValue,
  parseAuditData,
  parsePolicyValue,
  RETENTION_MAINTENANCE_INTERVAL_MS,
  RETENTION_SETTING_KEYS,
  timestampMs,
} from './audit.service.support';

export type { AuditLogEntry, AuditLogInput, AuditLogQuery, AuditLogSource, AuditType } from './audit.service.support';

/**
 * Writes observability records to the audit_log table.
 * Failures are logged as warnings and never propagate — the chat turn must not
 * be interrupted by an audit failure.
 *
 * log() returns the inserted row id so callers can incrementally update it
 * (e.g. live chunkCount updates during LLM streaming).
 */
@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private writeCount = 0;
  private pruning = false;
  private lastRetentionRunAt: number | null = null;
  private retentionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly drizzle: DrizzleService,
    @Optional() private readonly appSettings?: AppSettingsService,
  ) {}

  onModuleInit(): void {
    void this.runRetentionIfDue();
    this.retentionTimer = setInterval(() => {
      void this.runRetentionIfDue();
    }, RETENTION_MAINTENANCE_INTERVAL_MS);
    this.retentionTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (!this.retentionTimer) return;
    clearInterval(this.retentionTimer);
    this.retentionTimer = null;
  }

  async log(entry: AuditLogInput): Promise<string> {
    const id = nanoid();
    try {
      await this.drizzle.db.insert(auditLog).values({
        id,
        sessionId: entry.sessionId ?? null,
        type: entry.type,
        label: entry.label,
        data: entry.data ?? null,
        durationMs: entry.durationMs ?? null,
        chunkCount: entry.chunkCount ?? null,
        createdAt: new Date(),
      });
    } catch (err) {
      this.logger.warn(
        `Audit log failed [${entry.type}/${entry.label}]: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    void this.scheduleRetention();
    return id;
  }

  async update(id: string, patch: { chunkCount?: number; durationMs?: number; data?: Record<string, unknown> }): Promise<void> {
    try {
      await this.drizzle.db
        .update(auditLog)
        .set({
          ...(patch.chunkCount !== undefined ? { chunkCount: patch.chunkCount } : {}),
          ...(patch.durationMs !== undefined ? { durationMs: patch.durationMs } : {}),
          ...(patch.data !== undefined ? { data: patch.data } : {}),
        })
        .where(eq(auditLog.id, id));
    } catch (err) {
      this.logger.warn(
        `Audit update failed [${id}]: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async listEntries(query: AuditLogQuery): Promise<AuditLogEntry[]> {
    const statements = [];
    if (query.source !== 'archive') {
      statements.push(sql`
        SELECT
          id,
          session_id AS sessionId,
          type,
          label,
          data,
          duration_ms AS durationMs,
          chunk_count AS chunkCount,
          created_at AS createdAt
        FROM audit_log
        ${buildAuditWhereClause(query, 'audit_log')}
      `);
    }
    if (query.source !== 'hot') {
      statements.push(sql`
        SELECT
          id,
          session_id AS sessionId,
          type,
          label,
          data,
          duration_ms AS durationMs,
          chunk_count AS chunkCount,
          created_at AS createdAt
        FROM audit_log_archive
        ${buildAuditWhereClause(query, 'audit_log_archive')}
      `);
    }

    const dbWithAll = this.drizzle.db as typeof this.drizzle.db & {
      all?: <T = unknown>(query: unknown) => T[] | Promise<T[]>;
    };
    const rows = await dbWithAll.all?.<RawAuditLogEntry>(sql`
      SELECT *
      FROM (${sql.join(statements, sql` UNION ALL `)})
      ORDER BY createdAt DESC, id DESC
      LIMIT ${query.limit}
    `) ?? [];

    return rows
      .reverse()
      .map((row) => ({
        id: row.id,
        sessionId: row.sessionId,
        type: row.type,
        label: row.label,
        data: parseAuditData(row.data),
        durationMs: row.durationMs ?? null,
        chunkCount: row.chunkCount ?? null,
        createdAt: timestampMs(row.createdAt) ?? 0,
      }));
  }

  async retentionStatus(): Promise<AuditRetentionStatus> {
    const policy = await this.getRetentionPolicy();
    const [row] = await this.drizzle.db
      .select({
        hotRows: sql<number>`count(*)`,
        oldestHotEntryAt: sql<number | null>`min(${auditLog.createdAt})`,
        newestHotEntryAt: sql<number | null>`max(${auditLog.createdAt})`,
      })
      .from(auditLog);
    const [archiveRow] = await this.drizzle.db
      .select({
        archivedRows: sql<number>`count(*)`,
        oldestArchiveEntryAt: sql<number | null>`min(${auditLogArchive.createdAt})`,
        newestArchiveEntryAt: sql<number | null>`max(${auditLogArchive.createdAt})`,
      })
      .from(auditLogArchive);

    return {
      hotRows: Number(row?.hotRows ?? 0),
      archivedRows: Number(archiveRow?.archivedRows ?? 0),
      maxHotRows: policy.maxHotRows,
      maxArchivedRows: policy.maxArchivedRows,
      retentionDays: policy.retentionDays,
      archiveRetentionDays: policy.archiveRetentionDays,
      pruneEveryWrites: policy.pruneEveryWrites,
      pruneIntervalHours: policy.pruneIntervalHours,
      lastRetentionRunAt: await this.getLastRetentionRunAt(),
      nextRetentionRunAt: await this.nextRetentionRunAt(policy),
      oldestHotEntryAt: timestampMs(row?.oldestHotEntryAt),
      newestHotEntryAt: timestampMs(row?.newestHotEntryAt),
      oldestArchiveEntryAt: timestampMs(archiveRow?.oldestArchiveEntryAt),
      newestArchiveEntryAt: timestampMs(archiveRow?.newestArchiveEntryAt),
      coldStorageEnabled: true,
      coldStorageMode: 'sqlite_table',
    };
  }

  async runRetentionNow(): Promise<AuditRetentionStatus> {
    await this.enforceRetention();
    return this.retentionStatus();
  }

  async getRetentionPolicy(): Promise<AuditRetentionPolicy> {
    const defaults = defaultRetentionPolicy();
    if (!this.appSettings) return defaults;
    const entries = await Promise.all(
      (Object.keys(RETENTION_SETTING_KEYS) as Array<keyof AuditRetentionPolicy>).map(async (key) => [
        key,
        await this.appSettings?.get(RETENTION_SETTING_KEYS[key]),
      ] as const),
    );
    return entries.reduce<AuditRetentionPolicy>((policy, [key, value]) => ({
      ...policy,
      [key]: parsePolicyValue(key, value),
    }), defaults);
  }

  async setRetentionPolicy(input: Partial<AuditRetentionPolicy>): Promise<AuditRetentionPolicy> {
    if (!this.appSettings) throw new BadRequestException('Audit retention settings storage is unavailable');
    const updates = Object.entries(input) as Array<[keyof AuditRetentionPolicy, unknown]>;
    for (const [key, value] of updates) {
      if (!(key in RETENTION_SETTING_KEYS) || value === undefined) continue;
      await this.appSettings.set(RETENTION_SETTING_KEYS[key], String(normalizePolicyValue(key, value)));
    }
    return this.getRetentionPolicy();
  }

  private async scheduleRetention(): Promise<void> {
    this.writeCount += 1;
    const policy = await this.getRetentionPolicy();
    if (this.pruning) return;
    const dueByWrites = this.writeCount % policy.pruneEveryWrites === 0;
    const dueByTime = await this.isRetentionDue(policy);
    if (!dueByWrites && !dueByTime) return;
    this.pruning = true;
    void this.enforceRetention(policy)
      .catch((err) => {
        this.logger.warn(`Audit retention failed: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        this.pruning = false;
      });
  }

  private async runRetentionIfDue(): Promise<void> {
    if (this.pruning) return;
    const policy = await this.getRetentionPolicy();
    if (!await this.isRetentionDue(policy)) return;
    this.pruning = true;
    try {
      await this.enforceRetention(policy);
    } catch (err) {
      this.logger.warn(`Audit retention failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.pruning = false;
    }
  }

  private async enforceRetention(policy?: AuditRetentionPolicy): Promise<void> {
    const resolvedPolicy = policy ?? await this.getRetentionPolicy();
    const cutoff = new Date(Date.now() - resolvedPolicy.retentionDays * 24 * 60 * 60 * 1000);
    const dbWithRun = this.drizzle.db as typeof this.drizzle.db & { run?: (query: unknown) => unknown };

    await dbWithRun.run?.(sql`
      INSERT OR IGNORE INTO audit_log_archive (
        id, session_id, type, label, data, duration_ms, chunk_count, created_at, archived_at
      )
      SELECT id, session_id, type, label, data, duration_ms, chunk_count, created_at, ${Date.now()}
      FROM audit_log
      WHERE created_at < ${cutoff.getTime()}
    `);
    await this.drizzle.db.delete(auditLog).where(lt(auditLog.createdAt, cutoff));

    await dbWithRun.run?.(sql`
      INSERT OR IGNORE INTO audit_log_archive (
        id, session_id, type, label, data, duration_ms, chunk_count, created_at, archived_at
      )
      SELECT id, session_id, type, label, data, duration_ms, chunk_count, created_at, ${Date.now()}
      FROM audit_log
      WHERE id IN (
        SELECT id
        FROM audit_log
        ORDER BY created_at DESC
        LIMIT -1 OFFSET ${resolvedPolicy.maxHotRows}
      )
    `);
    await dbWithRun.run?.(sql`
      DELETE FROM audit_log
      WHERE id IN (
        SELECT id
        FROM audit_log
        ORDER BY created_at DESC
        LIMIT -1 OFFSET ${resolvedPolicy.maxHotRows}
      )
    `);

    const archiveCutoff = new Date(Date.now() - resolvedPolicy.archiveRetentionDays * 24 * 60 * 60 * 1000);
    await this.drizzle.db.delete(auditLogArchive).where(lt(auditLogArchive.archivedAt, archiveCutoff));
    await dbWithRun.run?.(sql`
      DELETE FROM audit_log_archive
      WHERE id IN (
        SELECT id
        FROM audit_log_archive
        ORDER BY archived_at DESC
        LIMIT -1 OFFSET ${resolvedPolicy.maxArchivedRows}
      )
    `);
    await this.recordRetentionRun(Date.now());
  }

  private async isRetentionDue(policy: AuditRetentionPolicy): Promise<boolean> {
    const lastRunAt = await this.getLastRetentionRunAt();
    if (lastRunAt == null) return true;
    return Date.now() - lastRunAt >= policy.pruneIntervalHours * 60 * 60 * 1000;
  }

  private async nextRetentionRunAt(policy: AuditRetentionPolicy): Promise<number | null> {
    const lastRunAt = await this.getLastRetentionRunAt();
    return lastRunAt == null ? null : lastRunAt + policy.pruneIntervalHours * 60 * 60 * 1000;
  }

  private async getLastRetentionRunAt(): Promise<number | null> {
    if (!this.appSettings) return this.lastRetentionRunAt;
    return timestampMs(await this.appSettings.get(LAST_RETENTION_RUN_KEY));
  }

  private async recordRetentionRun(timestamp: number): Promise<void> {
    this.lastRetentionRunAt = timestamp;
    if (this.appSettings) {
      await this.appSettings.set(LAST_RETENTION_RUN_KEY, String(timestamp));
    }
  }
}
