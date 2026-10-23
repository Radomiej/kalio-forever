import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { eq, sql } from 'drizzle-orm';
import type { KalioDrizzleDatabase } from '../../database/sqlite-runtime';
import { auditLog } from '../../database/schema';

export interface AuditGoalProofLocator {
  id: string;
  runId: string;
  rootSessionId: string;
  label: string;
  expectedDataSha256?: string;
}
export interface AuditGoalProofRecord {
  id: string;
  sessionId: string;
  type: 'architecture_event';
  label: string;
  data: Record<string, unknown>;
  dataJson: string;
  dataUtf8Bytes: number;
  dataSha256: string;
  createdAt: number;
  durationMs: number | null;
  chunkCount: number | null;
}
export interface AuditGoalAggregateInput {
  sessionId: string;
  type: 'architecture_event';
  label: 'goal_completion:aggregate';
  data: Record<string, unknown>;
}
type RawRow = { id: string; sessionId: string | null; type: string; label: string; dataJson: unknown;
  dataBytes: unknown; createdAt: unknown; durationMs: number | null; chunkCount: number | null; protected: number };
const fail = (code: string): never => { throw new Error(code); };
const checkAbort = (signal?: AbortSignal): void => { if (signal?.aborted) fail('AUDIT_PROOF_ABORTED'); };
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const digest = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const aggregatePrefix = 'goal-aggregate:sha256:';

/** Classification is a write barrier, NOT evidence of trusted producer origin. */
function protectedSql() {
  return sql`(id GLOB 'goal-aggregate:sha256:*' OR id GLOB '*:goal-state:*' OR id GLOB '*:goal-completion:*'
    OR label GLOB 'goal_receipt:*' OR label GLOB 'goal_completion:*' OR label GLOB 'goal_aggregate:*'
    OR label GLOB 'architecture_event:goal_*'
    OR CASE WHEN json_valid(data) THEN
      json_extract(data, '$.eventType') = 'goal_protocol'
      OR json_extract(data, '$.recordType') = 'goal_completion_aggregate'
      OR json_type(data, '$.goalBinding') IS NOT NULL
      OR json_type(data, '$.completionBinding') IS NOT NULL
      OR json_type(data, '$.goalProtocol') = 'true'
      ELSE 0 END)`;
}
function rows(db: KalioDrizzleDatabase, id: string): RawRow[] {
  return db.all<RawRow>(sql`SELECT id, session_id AS sessionId, type, label, data AS dataJson,
    cast(data AS blob) AS dataBytes, created_at AS createdAt, duration_ms AS durationMs, chunk_count AS chunkCount,
    ${protectedSql()} AS protected FROM audit_log WHERE id = ${id}
    UNION ALL SELECT id, session_id AS sessionId, type, label, data AS dataJson,
    cast(data AS blob) AS dataBytes, created_at AS createdAt, duration_ms AS durationMs, chunk_count AS chunkCount,
    ${protectedSql()} AS protected FROM audit_log_archive WHERE id = ${id}`);
}
/** Strict snapshot before serialization; no getters, proxies, hooks, holes or omissions. */
function cloneJson(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || types.isProxy(value) || ancestors.has(value) || ancestors.size >= 100) return fail('AUDIT_PROOF_INVALID_INPUT');
  const array = Array.isArray(value);
  if (array ? Object.getPrototypeOf(value) !== Array.prototype
    : ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail('AUDIT_PROOF_INVALID_INPUT');
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string') || (array && keys.length !== value.length + 1)) return fail('AUDIT_PROOF_INVALID_INPUT');
  ancestors.add(value);
  try {
    const entries: [string, unknown][] = [];
    for (const key of keys) {
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
        || (array && (!/^(0|[1-9]\d*)$/.test(String(key)) || Number(key) >= value.length))) return fail('AUDIT_PROOF_INVALID_INPUT');
      entries.push([String(key), cloneJson(descriptor.value, ancestors)]);
    }
    const result = array ? entries.sort((a, b) => Number(a[0]) - Number(b[0])).map(row => row[1]) : Object.fromEntries(entries);
    Object.setPrototypeOf(result, null); // Inherited toJSON hooks cannot change captured bytes.
    return result;
  } finally { ancestors.delete(value); }
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function scope(data: Record<string, unknown>, runId: string, rootSessionId: string): boolean {
  return data.rootSessionId === rootSessionId && (Object.hasOwn(data, 'runId') || Object.hasOwn(data, 'architectureRunId'))
    && (!Object.hasOwn(data, 'runId') || data.runId === runId)
    && (!Object.hasOwn(data, 'architectureRunId') || data.architectureRunId === runId);
}
function checkedLocator(raw: AuditGoalProofLocator): AuditGoalProofLocator {
  const value = cloneJson(raw);
  if (!object(value) || Object.keys(value).some(key => !['id', 'runId', 'rootSessionId', 'label', 'expectedDataSha256'].includes(key))
    || ![value.id, value.runId, value.rootSessionId, value.label].every(text)
    || (Object.hasOwn(value, 'expectedDataSha256') && (typeof value.expectedDataSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedDataSha256)))) return fail('AUDIT_PROOF_INVALID_INPUT');
  return value as unknown as AuditGoalProofLocator;
}
function decode(row: RawRow): AuditGoalProofRecord {
  if (typeof row.dataJson !== 'string' || !(row.dataBytes instanceof Uint8Array)
    || !Buffer.from(row.dataBytes).equals(Buffer.from(row.dataJson, 'utf8'))
    || typeof row.createdAt !== 'number' || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0 || row.createdAt > 8_640_000_000_000_000
    || !text(row.sessionId)) return fail('AUDIT_PROOF_CORRUPT');
  let data: unknown;
  try { data = JSON.parse(row.dataJson) as unknown; } catch { return fail('AUDIT_PROOF_CORRUPT'); }
  if (!object(data)) return fail('AUDIT_PROOF_CORRUPT');
  return { id: row.id, sessionId: row.sessionId, type: row.type as 'architecture_event', label: row.label,
    data, dataJson: row.dataJson, dataUtf8Bytes: row.dataBytes.byteLength, dataSha256: digest(row.dataJson),
    createdAt: row.createdAt, durationMs: row.durationMs, chunkCount: row.chunkCount };
}
function lookup(db: KalioDrizzleDatabase, key: AuditGoalProofLocator): AuditGoalProofRecord | null {
  const found = rows(db, key.id);
  if (found.length === 0) return null;
  // Compare raw copies BEFORE parsing, so a foreign/malformed duplicate never hides.
  const comparable = (row: RawRow) => JSON.stringify({ ...row, dataBytes: row.dataBytes instanceof Uint8Array ? Buffer.from(row.dataBytes).toString('hex') : row.dataBytes });
  if (found.length > 2 || found.some(row => comparable(row) !== comparable(found[0]!))) return fail('AUDIT_PROOF_CONFLICT');
  const record = decode(found[0]!);
  if (found[0]!.protected !== 1 || record.id !== key.id || record.type !== 'architecture_event' || record.label !== key.label
    || record.sessionId !== key.rootSessionId || !scope(record.data, key.runId, key.rootSessionId)) return fail('AUDIT_PROOF_SCOPE_INVALID');
  if (key.expectedDataSha256 !== undefined && key.expectedDataSha256 !== record.dataSha256
    || key.id.startsWith(aggregatePrefix) && key.id !== aggregatePrefix + record.dataSha256) return fail('AUDIT_PROOF_HASH_MISMATCH');
  if (record.data.recordType === 'goal_completion_aggregate' && !key.id.startsWith(aggregatePrefix)) return fail('AUDIT_PROOF_HASH_MISMATCH');
  return record;
}
function storage<T>(action: () => T, signal?: AbortSignal): T {
  try { return action(); }
  catch (error) {
    checkAbort(signal);
    if (error instanceof Error && /^AUDIT_PROOF_[A-Z_]+$/.test(error.message)) throw error;
    return fail('AUDIT_PROOF_STORAGE_ERROR');
  }
}
export async function readGoalProofExact(db: KalioDrizzleDatabase, raw: AuditGoalProofLocator, signal?: AbortSignal): Promise<AuditGoalProofRecord> {
  checkAbort(signal);
  const key = checkedLocator(raw);
  const record = storage(() => lookup(db, key), signal);
  checkAbort(signal);
  if (!record) return fail('AUDIT_PROOF_MISSING');
  return record;
}
export async function logContentAddressedGoalAggregateRequired(db: KalioDrizzleDatabase,
  raw: AuditGoalAggregateInput, signal?: AbortSignal): Promise<AuditGoalProofRecord> {
  checkAbort(signal);
  const entry = cloneJson(raw);
  if (!object(entry) || Object.keys(entry).length !== 4 || !['sessionId', 'type', 'label', 'data'].every(key => Object.hasOwn(entry, key))
    || !text(entry.sessionId) || entry.type !== 'architecture_event' || entry.label !== 'goal_completion:aggregate'
    || !object(entry.data) || entry.data.schemaVersion !== 1 || entry.data.recordType !== 'goal_completion_aggregate'
    || !text(entry.data.runId) || !scope(entry.data, entry.data.runId, entry.sessionId)) return fail('AUDIT_PROOF_INVALID_INPUT');
  const dataJson = JSON.stringify(entry.data);
  const key: AuditGoalProofLocator = { id: aggregatePrefix + digest(dataJson), runId: entry.data.runId, rootSessionId: entry.sessionId,
    label: entry.label, expectedDataSha256: digest(dataJson) };
  const result = storage(() => db.transaction(tx => {
    checkAbort(signal);
    const existing = lookup(tx, key); if (existing) return existing;
    tx.insert(auditLog).values({ id: key.id, sessionId: key.rootSessionId, type: 'architecture_event', label: key.label,
      data: sql`${dataJson}`, createdAt: new Date() }).run();
    checkAbort(signal);
    return lookup(tx, key) ?? fail('AUDIT_PROOF_MISSING');
  }), signal);
  checkAbort(signal);
  return result;
}
/** Synchronous transaction covers classification and update; a protected archive
 * copy also blocks a same-ID hot row. Ordinary update error handling stays caller-owned. */
export function updateMutableAudit(db: KalioDrizzleDatabase, id: string,
  patch: { chunkCount?: number; durationMs?: number; data?: Record<string, unknown> }): void {
  db.transaction(tx => {
    if (rows(tx, id).some(row => row.protected === 1)) return fail('AUDIT_PROOF_IMMUTABLE');
    if (!patch || typeof patch !== 'object' || types.isProxy(patch)) return fail('AUDIT_PROOF_INVALID_INPUT');
    const captured: Record<string, unknown> = {};
    for (const key of ['chunkCount', 'durationMs', 'data']) {
      const descriptor = Object.getOwnPropertyDescriptor(patch, key);
      if (!descriptor) continue;
      if (!Object.hasOwn(descriptor, 'value')) return fail('AUDIT_PROOF_INVALID_INPUT');
      if (descriptor.value !== undefined) captured[key] = cloneJson(descriptor.value);
    }
    const snapshot = captured as typeof patch;
    tx.update(auditLog).set({
      ...(snapshot.chunkCount !== undefined ? { chunkCount: snapshot.chunkCount } : {}),
      ...(snapshot.durationMs !== undefined ? { durationMs: snapshot.durationMs } : {}),
      ...(snapshot.data !== undefined ? { data: sql`${JSON.stringify(snapshot.data)}` } : {}),
    }).where(eq(auditLog.id, id)).run();
  });
}
