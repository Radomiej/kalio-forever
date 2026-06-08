import { BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AuditRetentionPolicy, AuditType } from '@kalio/types';

export type { AuditType };

export interface AuditLogInput {
  sessionId?: string;
  type: AuditType;
  label: string;
  data?: Record<string, unknown>;
  durationMs?: number;
  chunkCount?: number;
}

export type AuditLogSource = 'hot' | 'archive' | 'all';

export interface AuditLogQuery {
  limit: number;
  source: AuditLogSource;
  types?: AuditType[] | null;
  sessionId?: string;
  since?: number | null;
  until?: number | null;
}

export interface AuditLogEntry {
  id: string;
  sessionId: string | null;
  type: AuditType;
  label: string;
  data: Record<string, unknown> | null;
  durationMs: number | null;
  chunkCount: number | null;
  createdAt: number;
}

export interface RawAuditLogEntry {
  id: string;
  sessionId: string | null;
  type: AuditType;
  label: string;
  data: string | Record<string, unknown> | null;
  durationMs: number | null;
  chunkCount: number | null;
  createdAt: number | string | Date;
}

export const RETENTION_SETTING_KEYS: Record<keyof AuditRetentionPolicy, string> = {
  retentionDays: 'audit_retention_days',
  archiveRetentionDays: 'audit_archive_retention_days',
  pruneEveryWrites: 'audit_prune_every_writes',
  pruneIntervalHours: 'audit_prune_interval_hours',
  maxHotRows: 'audit_max_hot_rows',
  maxArchivedRows: 'audit_max_archived_rows',
};

const RETENTION_BOUNDS: Record<keyof AuditRetentionPolicy, { min: number; max: number }> = {
  retentionDays: { min: 1, max: 365 },
  archiveRetentionDays: { min: 1, max: 3650 },
  pruneEveryWrites: { min: 1, max: 100_000 },
  pruneIntervalHours: { min: 1, max: 24 * 30 },
  maxHotRows: { min: 100, max: 2_000_000 },
  maxArchivedRows: { min: 1_000, max: 10_000_000 },
};

export const LAST_RETENTION_RUN_KEY = 'audit_last_retention_run_at';
export const RETENTION_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

export function normalizePolicyValue(key: keyof AuditRetentionPolicy, raw: unknown): number {
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  const bounds = RETENTION_BOUNDS[key];
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException(`Invalid audit retention value for ${key}`);
  }
  return Math.max(bounds.min, Math.min(Math.trunc(parsed), bounds.max));
}

export function parsePolicyValue(key: keyof AuditRetentionPolicy, raw: string | null | undefined): number {
  if (raw == null) return defaultRetentionPolicy()[key];
  return normalizePolicyValue(key, raw);
}

export function defaultRetentionPolicy(): AuditRetentionPolicy {
  return {
    retentionDays: readPositiveInt('AUDIT_LOG_RETENTION_DAYS', 30),
    archiveRetentionDays: readPositiveInt('AUDIT_LOG_ARCHIVE_RETENTION_DAYS', 30),
    pruneEveryWrites: readPositiveInt('AUDIT_LOG_PRUNE_EVERY_WRITES', 100),
    pruneIntervalHours: readPositiveInt('AUDIT_LOG_PRUNE_INTERVAL_HOURS', 24),
    maxHotRows: readPositiveInt('AUDIT_LOG_MAX_ROWS', 50_000),
    maxArchivedRows: readPositiveInt('AUDIT_LOG_ARCHIVE_MAX_ROWS', 250_000),
  };
}

function readPositiveInt(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function buildAuditWhereClause(query: AuditLogQuery, tableName: 'audit_log' | 'audit_log_archive') {
  const conditions = [];
  if (query.types && query.types.length > 0) {
    conditions.push(sql`${sql.raw(`${tableName}.type`)} IN (${sql.join(query.types.map((type) => sql`${type}`), sql`, `)})`);
  }
  if (query.sessionId) {
    conditions.push(sql`${sql.raw(`${tableName}.session_id`)} = ${query.sessionId}`);
  }
  if (query.since != null && Number.isFinite(query.since)) {
    conditions.push(sql`${sql.raw(`${tableName}.created_at`)} >= ${query.since}`);
  }
  if (query.until != null && Number.isFinite(query.until)) {
    conditions.push(sql`${sql.raw(`${tableName}.created_at`)} <= ${query.until}`);
  }
  return conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
}

export function parseAuditData(value: string | Record<string, unknown> | null): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return { raw: value };
  }
}

export function timestampMs(value: Date | number | string | null | undefined): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
