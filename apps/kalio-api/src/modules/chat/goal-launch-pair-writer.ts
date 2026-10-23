import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { sql } from 'drizzle-orm';
import type { KalioDrizzleDatabase } from '../../database/sqlite-runtime';
import { auditLog } from '../../database/schema';
import type { AuditGoalProofLocator } from './audit-goal-proof';
import { requireGoalLaunchReservationExact, type GoalLaunchReservationClaim } from './goal-launch-reservation';

const authorizationLabel = 'architecture_event:goal_launch_authorization';
const admissionLabel = 'architecture_event:goal_route_admission';
export function assertNotReservedGoalLaunchLabel(label: string): void {
  if (label === authorizationLabel || label === admissionLabel) throw new Error('AUDIT_GOAL_LAUNCH_RESERVED');
}
export interface GoalLaunchPairInput {
  reservation: GoalLaunchReservationClaim;
  authorizationId: string;
  admissionId: string;
  authorizationData: Readonly<Record<string, unknown>>;
  /** Existing GoalRouteAdmissionV1 launch payload WITHOUT authorizationRef.
   * Host producer validates node/branch/schema through the existing decoder.
   * This storage module deliberately has no reverse Architecture dependency. */
  admissionData: Readonly<Record<string, unknown>>;
}
type ProofRef = Required<Pick<AuditGoalProofLocator, 'id' | 'label' | 'expectedDataSha256'>>;
export interface GoalLaunchPairRefs { authorizationRef: ProofRef; admissionRef: ProofRef; }
const fail = (code: string): never => { throw new Error(`GOAL_LAUNCH_PAIR_${code}`); };
const abort = (signal?: AbortSignal): void => { if (signal?.aborted) fail('ABORTED'); };
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const digest = (v: string): string => createHash('sha256').update(v, 'utf8').digest('hex');
function record(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function exact(v: unknown, keys: readonly string[]): v is Record<string, unknown> {
  return record(v) && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
}
/** Detached plain JSON with null prototypes: no getters, proxies or inherited toJSON. */
function clone(v: unknown, parents = new Set<object>()): unknown {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (!v || typeof v !== 'object' || types.isProxy(v) || parents.has(v) || parents.size >= 100) return fail('INVALID');
  const array = Array.isArray(v); const proto = Object.getPrototypeOf(v);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return fail('INVALID');
  const keys = Reflect.ownKeys(v);
  if (keys.some(k => typeof k !== 'string') || array && keys.length !== v.length + 1) return fail('INVALID');
  parents.add(v);
  try {
    const entries: [string, unknown][] = [];
    for (const k of keys) {
      if (array && k === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (!d?.enumerable || !('value' in d) || array && (!/^(0|[1-9]\d*)$/.test(String(k)) || Number(k) >= v.length)) return fail('INVALID');
      entries.push([String(k), clone(d.value, parents)]);
    }
    const result = array ? entries.sort((a, b) => Number(a[0]) - Number(b[0])).map(e => e[1]) : Object.fromEntries(entries);
    Object.setPrototypeOf(result, null); return result;
  } finally { parents.delete(v); }
}
function binding(v: unknown): string {
  const keys = ['stateRevision', 'sourceVersion', 'sourceFingerprint'];
  if (!record(v) || !keys.every(k => Object.hasOwn(v, k))
    || Object.keys(v).some(k => ![...keys, 'proposalFingerprint'].includes(k))
    || !positive(v.stateRevision) || !positive(v.sourceVersion)
    || typeof v.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(v.sourceFingerprint)
    || Object.hasOwn(v, 'proposalFingerprint') && (typeof v.proposalFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(v.proposalFingerprint))) return fail('INVALID');
  return JSON.stringify([v.stateRevision, v.sourceVersion, v.sourceFingerprint, v.proposalFingerprint ?? null]);
}
type Row = { id: string; sessionId: string | null; type: string; label: string; data: unknown; bytes: unknown;
  createdAt: unknown; durationMs: unknown; chunkCount: unknown };
function lookup(db: KalioDrizzleDatabase, id: string): Row | null {
  const rows = db.all<Row>(sql`SELECT id,session_id AS sessionId,type,label,data,CAST(data AS BLOB) AS bytes,
    created_at AS createdAt,duration_ms AS durationMs,chunk_count AS chunkCount FROM audit_log WHERE id=${id}
    UNION ALL SELECT id,session_id AS sessionId,type,label,data,CAST(data AS BLOB) AS bytes,
    created_at AS createdAt,duration_ms AS durationMs,chunk_count AS chunkCount FROM audit_log_archive WHERE id=${id}`);
  const comparable = (r: Row) => JSON.stringify({ ...r, bytes: r.bytes instanceof Uint8Array ? Buffer.from(r.bytes).toString('hex') : r.bytes });
  if (rows.length > 2 || rows.some(r => comparable(r) !== comparable(rows[0]!))) return fail('CONFLICT');
  return rows[0] ?? null;
}
function checkedRow(row: Row, id: string, label: string, root: string, json: string): void {
  if (row.id !== id || row.sessionId !== root || row.type !== 'architecture_event' || row.label !== label || row.data !== json
    || !(row.bytes instanceof Uint8Array) || !Buffer.from(row.bytes).equals(Buffer.from(json, 'utf8'))
    || !positive(row.createdAt) || row.durationMs !== null || row.chunkCount !== null) return fail('CONFLICT');
}

/** Real synchronous SQLite backing, NOT a dispatcher mint or origin verifier.
 * Only trusted composition receives this writer. readCapability must be a private
 * identity-map lookup populated by actual dispatcher entry; no default exists.
 * Generic audit writes cannot insert these exact reserved labels. Producer and
 * assembly remain mandatory; source/node authority never comes from JSON flags. */
export function createGoalLaunchPairWriter(db: KalioDrizzleDatabase,
  readCapability: (capability: object) => GoalLaunchPairInput | null): {
    writeRequired(capability: object, signal?: AbortSignal): GoalLaunchPairRefs;
  } {
  if (typeof readCapability !== 'function') return fail('CAPABILITY');
  const claims = new WeakMap<object, string>();
  return Object.freeze({ writeRequired(capability: object, signal?: AbortSignal): GoalLaunchPairRefs {
    try {
      abort(signal);
      if (!capability || typeof capability !== 'object' || types.isProxy(capability)) return fail('CAPABILITY');
      const captured = readCapability(capability);
      if (captured === null) return fail('CAPABILITY');
      const pair = clone(captured);
      if (!exact(pair, ['reservation', 'authorizationId', 'admissionId', 'authorizationData', 'admissionData'])
        || !text(pair.authorizationId) || !text(pair.admissionId) || pair.authorizationId === pair.admissionId
        || !record(pair.authorizationData) || !record(pair.admissionData)) return fail('INVALID');
      const auth = pair.authorizationData; const admission = pair.admissionData;
      const baseKeys = ['schemaVersion', 'goalProtocol', 'runId', 'rootSessionId', 'schemaId', 'sequence', 'binding'];
      const admissionKeys = [...baseKeys, 'recordType', 'admissionKind', 'nodeId', 'visit', 'branchSessionId', 'predecessorAdmissionRef', 'stopRef', 'entryRouteRef'];
      if (!exact(admission, admissionKeys) || auth.recordType !== 'goal_launch_authorization'
        || admission.recordType !== 'goal_route_admission' || admission.admissionKind !== 'launch'
        || [auth, admission].some(d => d.schemaVersion !== 1 || d.goalProtocol !== true
          || !text(d.runId) || !text(d.rootSessionId) || !text(d.schemaId) || !positive(d.sequence)
          || Object.hasOwn(d, 'architectureRunId') && d.architectureRunId !== d.runId)
        || ['runId', 'rootSessionId', 'schemaId'].some(k => auth[k] !== admission[k])
        || binding(auth.binding) !== binding(admission.binding) || Number(admission.sequence) <= Number(auth.sequence)
        || !text(admission.nodeId) || !positive(admission.visit)
        || admission.branchSessionId !== null && !text(admission.branchSessionId)
        || admission.predecessorAdmissionRef !== null || admission.stopRef !== null || admission.entryRouteRef !== null) return fail('INVALID');
      const authJson = JSON.stringify(auth);
      const authorizationRef: ProofRef = { id: pair.authorizationId, label: authorizationLabel, expectedDataSha256: digest(authJson) };
      const admissionJson = JSON.stringify({ ...admission, authorizationRef });
      const refs = { authorizationRef, admissionRef: { id: pair.admissionId, label: admissionLabel, expectedDataSha256: digest(admissionJson) } };
      const claim = JSON.stringify([pair.authorizationId, pair.admissionId, authJson, admissionJson]);
      const previous = claims.get(capability);
      if (previous !== undefined && previous !== claim) return fail('CONFLICT');
      claims.set(capability, claim);
      const root = auth.rootSessionId as string;
      return db.transaction(tx => {
        abort(signal);
        const reservation = requireGoalLaunchReservationExact(tx, pair.reservation, {
          childRunId: auth.runId, rootSessionId: auth.rootSessionId,
          authorizationId: pair.authorizationId, admissionId: pair.admissionId,
        }, signal);
        const source = auth.source;
        // The canonical snapshot/hash was recomputed by the reservation module.
        const descriptor: unknown = JSON.parse(reservation.descriptorJson);
        if (!exact(source, ['sessionId', 'messageId', 'turnId'])
          || source.sessionId !== reservation.parent.parentSessionId || source.messageId !== reservation.parent.promptMessageId
          || source.turnId !== reservation.parent.parentTurnId || auth.parentRunId !== reservation.parent.parentRunId
          || auth.parentToolCallId !== reservation.parent.callId || !record(descriptor) || auth.schemaId !== descriptor.schemaId
          || auth.reservationDescriptorSha256 !== reservation.descriptorSha256) return fail('RESERVATION');
        const existingAuth = lookup(tx, pair.authorizationId as string); const existingAdmission = lookup(tx, pair.admissionId as string);
        if (!!existingAuth !== !!existingAdmission) return fail('CONFLICT');
        if (!existingAuth) {
          const createdAt = new Date();
          for (const [ref, json] of [[authorizationRef, authJson], [refs.admissionRef, admissionJson]] as const) {
            tx.insert(auditLog).values({ id: ref.id, sessionId: root, type: 'architecture_event', label: ref.label,
              data: sql`${json}`, createdAt }).run();
          }
        }
        const savedAuth = lookup(tx, authorizationRef.id); const savedAdmission = lookup(tx, refs.admissionRef.id);
        if (!savedAuth || !savedAdmission) return fail('CONFLICT');
        checkedRow(savedAuth, authorizationRef.id, authorizationLabel, root, authJson);
        checkedRow(savedAdmission, refs.admissionRef.id, admissionLabel, root, admissionJson);
        abort(signal);
        return refs;
      }, { behavior: 'immediate' });
    } catch (error) {
      abort(signal);
      if (error instanceof Error && /^GOAL_LAUNCH_PAIR_[A-Z_]+$/.test(error.message)) throw error;
      if (error instanceof Error && /^GOAL_LAUNCH_RESERVATION_[A-Z_]+$/.test(error.message)) return fail('RESERVATION');
      return fail('STORAGE_ERROR');
    }
  } });
}
