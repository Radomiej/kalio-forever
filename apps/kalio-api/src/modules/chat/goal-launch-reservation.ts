import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { sql } from 'drizzle-orm';
import type { KalioDrizzleDatabase } from '../../database/sqlite-runtime';
import { goalLaunchReservations } from '../../database/schema';

export interface GoalLaunchParentKey {
  parentRunId: string; parentSessionId: string; parentTurnId: string; promptMessageId: string; callId: string;
}
/** Host-normalized, noncontent allocation fields only. Digests bind omitted
 * arguments/source and actual normalized host definitions. IDs alone do not
 * bind mutable definitions; this storage boundary does not verify provenance. */
export interface GoalLaunchAllocationDescriptorV1 {
  version: 1; flowDefinitionId: string; schemaId: string;
  startMode: 'durable' | 'blocking'; vfsMode: 'isolated' | 'shared';
  returnMode: 'summary' | 'full_trace' | 'artifacts_only'; copyBack: boolean;
  maxSteps: number | null; argsSha256: string; sourceContentSha256: string;
  schemaDefinitionSha256: string; flowDefinitionSha256: string;
}
export interface GoalLaunchReservedIds {
  childRunId: string; rootSessionId: string; authorizationId: string; admissionId: string;
}
export interface GoalLaunchReservationClaim {
  parent: GoalLaunchParentKey; descriptor: GoalLaunchAllocationDescriptorV1; descriptorSha256: string;
}
export interface GoalLaunchReservation {
  parent: GoalLaunchParentKey; ids: GoalLaunchReservedIds; descriptorVersion: 1;
  descriptorJson: string; descriptorSha256: string; createdAt: number;
}
const parentKeys = ['parentRunId', 'parentSessionId', 'parentTurnId', 'promptMessageId', 'callId'] as const;
const idKeys = ['childRunId', 'rootSessionId', 'authorizationId', 'admissionId'] as const;
const descriptorKeys = ['version', 'flowDefinitionId', 'schemaId', 'startMode', 'vfsMode', 'returnMode',
  'copyBack', 'maxSteps', 'argsSha256', 'sourceContentSha256', 'schemaDefinitionSha256', 'flowDefinitionSha256'] as const;
const fail = (code: string): never => { throw new Error(`GOAL_LAUNCH_RESERVATION_${code}`); };
const abort = (signal?: AbortSignal): void => { if (signal?.aborted) fail('ABORTED'); };
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 512 && !!v.trim() && v === v.trim();
const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const hash = (v: string): string => createHash('sha256').update(v, 'utf8').digest('hex');
/** All allowed fields are primitives. Inspect descriptors before reading values. */
function fields(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || types.isProxy(input)) return fail('INVALID');
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return fail('INVALID');
  const own = Reflect.ownKeys(input);
  if (own.length !== keys.length || own.some(k => typeof k !== 'string' || !keys.includes(k))) return fail('INVALID');
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d?.enumerable || !('value' in d)) return fail('INVALID');
    out[key] = d.value;
  }
  return out;
}
function parentKey(input: unknown): GoalLaunchParentKey {
  const v = fields(input, parentKeys);
  const { parentRunId, parentSessionId, parentTurnId, promptMessageId, callId } = v;
  if (!text(parentRunId) || !text(parentSessionId) || !text(parentTurnId) || !text(promptMessageId) || !text(callId)) return fail('INVALID');
  return { parentRunId, parentSessionId, parentTurnId, promptMessageId, callId };
}
function reservedIds(input: unknown): GoalLaunchReservedIds {
  const { childRunId, rootSessionId, authorizationId, admissionId } = fields(input, idKeys);
  if (!text(childRunId) || !text(rootSessionId) || !text(authorizationId) || !text(admissionId)
    || new Set([childRunId, rootSessionId, authorizationId, admissionId]).size !== 4) return fail('INVALID');
  return { childRunId, rootSessionId, authorizationId, admissionId };
}
function canonicalDescriptor(input: unknown): string {
  const v = fields(input, descriptorKeys);
  if (v.version !== 1 || !text(v.flowDefinitionId) || !text(v.schemaId)
    || v.startMode !== 'durable' && v.startMode !== 'blocking'
    || v.vfsMode !== 'isolated' && v.vfsMode !== 'shared'
    || v.returnMode !== 'summary' && v.returnMode !== 'full_trace' && v.returnMode !== 'artifacts_only'
    || typeof v.copyBack !== 'boolean'
    || v.maxSteps !== null && (typeof v.maxSteps !== 'number' || !Number.isSafeInteger(v.maxSteps) || v.maxSteps < 1 || v.maxSteps > 50)
    || !sha(v.argsSha256) || !sha(v.sourceContentSha256)
    || !sha(v.schemaDefinitionSha256) || !sha(v.flowDefinitionSha256)) return fail('INVALID');
  return JSON.stringify(v);
}
function checkParent(db: KalioDrizzleDatabase, key: GoalLaunchParentKey): void {
  const row = db.get<{ sessionId: string; turnId: string }>(sql`SELECT session_id AS sessionId, turn_id AS turnId
    FROM chat_runs WHERE id=${key.parentRunId}`);
  if (!row || row.sessionId !== key.parentSessionId || row.turnId !== key.parentTurnId) fail('PARENT');
}
function lookup(db: KalioDrizzleDatabase, p: GoalLaunchParentKey): GoalLaunchReservation | null {
  const row = db.get<{ childRunId: string; rootSessionId: string; authorizationId: string; admissionId: string;
    descriptorVersion: number; descriptorJson: string; descriptorSha256: string; createdAt: number }>(sql`
    SELECT child_run_id AS childRunId, root_session_id AS rootSessionId, authorization_id AS authorizationId,
    admission_id AS admissionId, descriptor_version AS descriptorVersion, descriptor_json AS descriptorJson,
    descriptor_sha256 AS descriptorSha256, created_at AS createdAt FROM goal_launch_reservations
    WHERE parent_run_id=${p.parentRunId} AND parent_session_id=${p.parentSessionId}
      AND parent_turn_id=${p.parentTurnId} AND prompt_message_id=${p.promptMessageId} AND call_id=${p.callId}`);
  if (!row) return null;
  const canonical = canonicalDescriptor(JSON.parse(row.descriptorJson));
  if (row.descriptorVersion !== 1 || canonical !== row.descriptorJson || hash(canonical) !== row.descriptorSha256
    || !Number.isSafeInteger(row.createdAt) || row.createdAt <= 0) return fail('CONFLICT');
  return { parent: { ...p }, ids: reservedIds({ childRunId: row.childRunId, rootSessionId: row.rootSessionId,
    authorizationId: row.authorizationId, admissionId: row.admissionId }), descriptorVersion: 1,
    descriptorJson: canonical, descriptorSha256: row.descriptorSha256, createdAt: row.createdAt };
}
function boundary<T>(signal: AbortSignal | undefined, operation: () => T): T {
  try { abort(signal); return operation(); }
  catch (error) {
    abort(signal);
    if (error instanceof Error && /^GOAL_LAUNCH_RESERVATION_[A-Z_]+$/.test(error.message)) throw error;
    return fail('STORAGE');
  }
}
/** Closed exact check on the caller's transaction connection. Does not start a
 * transaction, allocate IDs, or authorize a launch. Pair writers must call this
 * inside the same synchronous transaction as their required inserts. */
export function requireGoalLaunchReservationExact(tx: KalioDrizzleDatabase, claim: unknown,
  ids: unknown, signal?: AbortSignal): GoalLaunchReservation {
  return boundary(signal, () => {
    const captured = fields(claim, ['parent', 'descriptor', 'descriptorSha256']);
    const p = parentKey(captured.parent); const json = canonicalDescriptor(captured.descriptor);
    const expected = reservedIds(ids);
    if (!sha(captured.descriptorSha256) || hash(json) !== captured.descriptorSha256) return fail('CONFLICT');
    checkParent(tx, p);
    const saved = lookup(tx, p);
    if (!saved || saved.descriptorJson !== json || saved.descriptorSha256 !== captured.descriptorSha256
      || idKeys.some(k => saved.ids[k] !== expected[k])) return fail('CONFLICT');
    abort(signal); return saved;
  });
}
/** Synchronous operational backing only. Live parent/capability checks remain
 * mandatory at the dispatcher producer. Never delete/reassign on Stop/failure.
 * allocateIds must be synchronous and side-effect-free except ID generation. */
export function createGoalLaunchReservationStore(db: KalioDrizzleDatabase, allocateIds: () => GoalLaunchReservedIds): {
  reserve(parent: unknown, descriptor: unknown, signal?: AbortSignal): GoalLaunchReservation;
  readExact(parent: unknown, signal?: AbortSignal): GoalLaunchReservation | null;
} {
  if (typeof allocateIds !== 'function') return fail('INVALID');
  return Object.freeze({
    reserve(parent: unknown, descriptor: unknown, signal?: AbortSignal): GoalLaunchReservation {
      return boundary(signal, () => {
        const p = parentKey(parent); const json = canonicalDescriptor(descriptor);
        return db.transaction(tx => {
          abort(signal); checkParent(tx, p);
          const existing = lookup(tx, p);
          if (existing) {
            if (existing.descriptorJson !== json) return fail('CONFLICT');
            abort(signal); return existing;
          }
          const ids = reservedIds(allocateIds()); abort(signal);
          tx.insert(goalLaunchReservations).values({ ...p, ...ids, descriptorVersion: 1,
            descriptorJson: json, descriptorSha256: hash(json), createdAt: Date.now() }).run();
          const saved = lookup(tx, p);
          if (!saved || saved.descriptorJson !== json || idKeys.some(k => saved.ids[k] !== ids[k])) return fail('CONFLICT');
          abort(signal); return saved;
        }, { behavior: 'immediate' });
      });
    },
    readExact(parent: unknown, signal?: AbortSignal): GoalLaunchReservation | null {
      return boundary(signal, () => {
        const p = parentKey(parent);
        return db.transaction(tx => { checkParent(tx, p); const saved = lookup(tx, p); abort(signal); return saved; });
      });
    },
  });
}
