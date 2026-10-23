import type { HostDispatchApproval, HostHitlExecutionCommit, HostRuntimeReceiptIdentity } from '@kalio/types';
import { types } from 'node:util';
import { and, eq, sql } from 'drizzle-orm';
import { chatRuns, messages, hitlRequests } from '../../database/schema';
import type { KalioDrizzleDatabase } from '../../database/sqlite-runtime';
import type { HostDispatchReceiptRecorderPorts } from './host-dispatch-receipts';

const fail = (kind: string): never => { throw new Error(`HOST_DISPATCH_AUTHORITY_${kind}`); };
const identityFields = ['runId', 'sessionId', 'turnId', 'promptMessageId'];
const commitFields = ['requestId', 'claimedRevision', 'committedRevision', 'status', 'executionState', 'resultStatus'];
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function check(condition: unknown): asserts condition { if (!condition) fail('INVALID'); }
/** Reject proxies before reflection and inspect descriptors before values. */
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  check(value && typeof value === 'object' && !types.isProxy(value) && !Array.isArray(value));
  const prototype = Object.getPrototypeOf(value);
  check(prototype === Object.prototype || prototype === null);
  const own = Reflect.ownKeys(value);
  check(own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key)));
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    check(descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value'));
    Object.defineProperty(result, key, { enumerable: true, value: descriptor.value });
  }
  return result;
}
function identity(value: unknown): HostRuntimeReceiptIdentity {
  const r = fields(value, identityFields); check(identityFields.every(key => text(r[key])));
  return Object.freeze({ runId: r.runId as string, sessionId: r.sessionId as string,
    turnId: r.turnId as string, promptMessageId: r.promptMessageId as string });
}
function abort(signal?: AbortSignal) { if (signal?.aborted) fail('ABORTED'); }
function json(value: unknown, bytes: unknown): Record<string, unknown> | null {
  if (value === null) { if (bytes !== null) fail('CORRUPT'); return null; }
  if (typeof value !== 'string' || !(bytes instanceof Uint8Array)
    || !Buffer.from(bytes).equals(Buffer.from(value, 'utf8'))) return fail('CORRUPT');
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; } catch { return fail('CORRUPT'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('CORRUPT');
  return parsed as Record<string, unknown>;
}

/** Concrete persistence readback only. Neither this projection nor an approved
 * status proves human origin, BUILD eligibility or executor entry. No audit JSON
 * is consumed. Legacy rows without durable hostExecutionCommit fail closed.
 * Claimed/committed revisions are read from that explicit producer-written
 * object; never reconstructed from increments or copied from dispatcher claims.
 * SQLite reads are synchronous; caller signal is checked before/after each read. */
export function createHostDispatchPersistenceAuthority(
  db: KalioDrizzleDatabase,
): Pick<HostDispatchReceiptRecorderPorts, 'readJournalScopeExact' | 'readHitlExact'> {
  return {
    async readJournalScopeExact(input, signal) {
      abort(signal); const key = identity(input);
      let row;
      try {
        row = db.select({ runId: chatRuns.id, sessionId: chatRuns.sessionId, turnId: chatRuns.turnId,
          promptMessageId: messages.id, revision: sql<unknown>`${chatRuns.revision}` }).from(chatRuns)
          .innerJoin(messages, and(eq(messages.id, key.promptMessageId), eq(messages.sessionId, chatRuns.sessionId),
            eq(messages.turnId, chatRuns.turnId), eq(messages.promptMessageId, messages.id), eq(messages.role, 'user')))
          .where(and(eq(chatRuns.id, key.runId), eq(chatRuns.sessionId, key.sessionId), eq(chatRuns.turnId, key.turnId))).get();
      } catch { return fail('STORAGE'); }
      abort(signal); if (!row) return null;
      if (!positive(row.revision) || identityFields.some(field => row[field as keyof typeof row] !== key[field as keyof typeof key])) return fail('CORRUPT');
      return Object.freeze({ ...key, revision: row.revision });
    },
    async readHitlExact(input, inputApproval, inputCommit, signal) {
      abort(signal);
      const supplied = fields(input, [...identityFields, 'callId']);
      const key = identity(Object.fromEntries(identityFields.map(field => [field, supplied[field]])));
      check(text(supplied.callId)); const callId = supplied.callId;
      const a = fields(inputApproval, ['kind', 'requestId', 'claimedRevision']);
      check(a.kind === 'durable_confirmation' && text(a.requestId) && positive(a.claimedRevision));
      const c = fields(inputCommit, commitFields);
      check(text(c.requestId) && positive(c.claimedRevision) && positive(c.committedRevision)
        && c.committedRevision > c.claimedRevision && c.status === 'approved' && c.executionState === 'tool_result_committed'
        && typeof c.resultStatus === 'string' && ['success', 'error', 'cancelled'].includes(c.resultStatus));
      if (a.requestId !== c.requestId || a.claimedRevision !== c.claimedRevision) return null;
      let row;
      try {
        row = db.select({ requestId: hitlRequests.id, kind: hitlRequests.kind, status: hitlRequests.status,
          runId: hitlRequests.runId, sessionId: hitlRequests.sessionId, turnId: hitlRequests.turnId, callId: hitlRequests.toolCallId,
          revision: sql<unknown>`${hitlRequests.revision}`,
          payload: sql<unknown>`${hitlRequests.payload}`, payloadBytes: sql<unknown>`cast(${hitlRequests.payload} as blob)`,
          continuation: sql<unknown>`${hitlRequests.continuation}`, continuationBytes: sql<unknown>`cast(${hitlRequests.continuation} as blob)`,
          outcome: sql<unknown>`${hitlRequests.outcome}`, outcomeBytes: sql<unknown>`cast(${hitlRequests.outcome} as blob)`,
        }).from(hitlRequests).where(and(eq(hitlRequests.id, a.requestId), eq(hitlRequests.kind, 'tool_confirmation'),
          eq(hitlRequests.status, 'approved'), eq(hitlRequests.runId, key.runId), eq(hitlRequests.sessionId, key.sessionId),
          eq(hitlRequests.turnId, key.turnId), eq(hitlRequests.toolCallId, callId))).get();
      } catch { return fail('STORAGE'); }
      abort(signal); if (!row) return null;
      if (!positive(row.revision)) return fail('CORRUPT');
      if (row.revision !== c.committedRevision) return null;
      const payload = json(row.payload, row.payloadBytes);
      const continuation = json(row.continuation, row.continuationBytes);
      const outcome = json(row.outcome, row.outcomeBytes);
      if (!payload || !continuation || !outcome || !text(payload.toolName)
        || continuation.version !== 1 || continuation.kind !== 'approved_tool_then_resume_turn'
        || continuation.executionState !== 'tool_result_committed'
        || identityFields.some(field => continuation[field] !== key[field as keyof typeof key]) || outcome.status !== c.resultStatus) return null;
      if (!Object.hasOwn(continuation, 'hostExecutionCommit')) return null;
      let persisted: Record<string, unknown>;
      try { persisted = fields(continuation.hostExecutionCommit, commitFields); } catch { return fail('CORRUPT'); }
      if (commitFields.some(field => persisted[field] !== c[field]) || persisted.requestId !== row.requestId
        || persisted.committedRevision !== row.revision || persisted.status !== row.status
        || persisted.executionState !== continuation.executionState || persisted.resultStatus !== outcome.status) return null;
      if (Object.hasOwn(continuation, 'hostConfirmationRequirement')) {
        let requirement: Record<string, unknown>;
        try { requirement = fields(continuation.hostConfirmationRequirement, ['kind', 'toolName', 'callId']); } catch { return fail('CORRUPT'); }
        if (requirement.kind !== 'human_only' || requirement.toolName !== payload.toolName || requirement.callId !== callId) return null;
      }
      // Return only independently matched persisted metadata, no raw args/prose.
      const commit = Object.freeze({ requestId: persisted.requestId, claimedRevision: persisted.claimedRevision,
        committedRevision: persisted.committedRevision, status: persisted.status, executionState: persisted.executionState,
        resultStatus: persisted.resultStatus }) as unknown as HostHitlExecutionCommit;
      const approval = Object.freeze({ kind: 'durable_confirmation', requestId: commit.requestId,
        claimedRevision: commit.claimedRevision }) as Extract<HostDispatchApproval, { kind: 'durable_confirmation' }>;
      abort(signal);
      return Object.freeze({ identity: key, callId, toolName: payload.toolName, approval, commit });
    },
  };
}
