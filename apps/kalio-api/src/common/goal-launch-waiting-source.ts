import type { KalioDrizzleDatabase } from '../database/sqlite-runtime';
import type { GoalLaunchDisclosureV1, GoalLaunchHostRequirement } from '@kalio/types';
import { parseGoalLaunchDisclosureV1, parseGoalLaunchHostRequirement } from '@kalio/types';
import { sql } from 'drizzle-orm';
import { canonicalGoalLaunchJson, hashGoalLaunchJson } from './goal-launch-canonical';
import { readPersistedGoalLaunchCalls } from './goal-launch-persisted-call';
export type GoalLaunchSourceReadTransaction = Pick<KalioDrizzleDatabase, 'get' | 'all'>;
export interface GoalLaunchWaitingSourceInput {
  requestId: string;
  requestRevision: number;
  requirement: GoalLaunchHostRequirement;
  disclosure: GoalLaunchDisclosureV1;
}
type Row = Record<string, unknown>;
const invalid = (): never => { throw new Error('GOAL_LAUNCH_WAITING_SOURCE_INVALID'); };
function record(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Row;
}
function storedJson(value: unknown, bytes: unknown): Row {
  if (typeof value !== 'string' || !(bytes instanceof Uint8Array)
    || !Buffer.from(bytes).equals(Buffer.from(value, 'utf8'))) return invalid();
  const parsed: unknown = JSON.parse(value);
  canonicalGoalLaunchJson(parsed);
  return record(parsed);
}
function equal(a: unknown, b: unknown): boolean { return canonicalGoalLaunchJson(a) === canonicalGoalLaunchJson(b); }

/** Read-only paused-source predicate. Caller owns the synchronous transaction,
 * approval authority, current definition/policy validation and Stop fencing.
 * No DB writes, transaction creation, async work or registry reconstruction. */
export function assertGoalLaunchWaitingSource(tx: GoalLaunchSourceReadTransaction,
  input: GoalLaunchWaitingSourceInput, signal?: AbortSignal): void {
  const abort = (): void => { if (signal?.aborted) throw new Error('GOAL_LAUNCH_WAITING_SOURCE_ABORTED'); };
  try {
    abort();
    // Validate all descriptors/proxies/scalars before reading any caller property.
    const safe = record(JSON.parse(canonicalGoalLaunchJson(input)) as unknown);
    if (Object.keys(safe).length !== 4 || !['requestId','requestRevision','requirement','disclosure'].every(key => Object.hasOwn(safe, key))) return invalid();
    const requirement = parseGoalLaunchHostRequirement(safe.requirement);
    const disclosure = parseGoalLaunchDisclosureV1(safe.disclosure);
    const binding = requirement.goalLaunch;
    const requestRevision = safe.requestRevision;
    if (typeof requestRevision !== 'number' || !Number.isSafeInteger(requestRevision) || requestRevision <= 0) return invalid();
    const requestId = safe.requestId;
    if (typeof requestId !== 'string' || !requestId || requestId !== requestId.trim() || Array.from(requestId).length > 512) return invalid();
    if (hashGoalLaunchJson(disclosure) !== binding.disclosureSha256) return invalid();
    abort();
    const request = tx.get<Row>(sql`SELECT id,revision,kind,status,session_id AS sessionId,run_id AS runId,turn_id AS turnId,
      tool_call_id AS toolCallId,payload,CAST(payload AS BLOB) AS payloadBytes,
      continuation,CAST(continuation AS BLOB) AS continuationBytes,outcome,resolved_at AS resolvedAt
      FROM hitl_requests WHERE id=${requestId} AND revision=${requestRevision}`);
    abort();
    if (!request || request.id !== requestId || request.revision !== requestRevision || request.kind !== 'tool_confirmation'
      || request.status !== 'pending' || request.sessionId !== binding.parentSessionId || request.runId !== binding.parentRunId
      || request.turnId !== binding.parentTurnId || request.toolCallId !== requirement.callId
      || request.outcome !== null || request.resolvedAt !== null) return invalid();
    // Pending-only uniqueness. Approved unresolved execution exclusion remains
    // a separate decision/claim service policy, not a newest-row heuristic here.
    const pending = tx.all<Row>(sql`SELECT id FROM hitl_requests WHERE status='pending'
      AND run_id=${binding.parentRunId} AND session_id=${binding.parentSessionId}
      AND turn_id=${binding.parentTurnId} AND tool_call_id=${requirement.callId}`);
    abort();
    if (pending.length !== 1 || pending[0]?.id !== requestId) return invalid();
    const payload = storedJson(request.payload, request.payloadBytes);
    const continuation = storedJson(request.continuation, request.continuationBytes);
    if (payload.toolName !== 'run_sub_agentflow' || !Object.hasOwn(payload, 'args') || !Object.hasOwn(payload, 'goalLaunchDisclosure')
      || continuation.version !== 1 || continuation.kind !== 'approved_tool_then_resume_turn'
      || continuation.phase !== 'tool_pending' || continuation.executionState !== 'pending'
      || continuation.runId !== binding.parentRunId || continuation.sessionId !== binding.parentSessionId
      || continuation.turnId !== binding.parentTurnId || continuation.promptMessageId !== binding.promptMessageId
      || continuation.messageId !== binding.assistantMessageId || !Object.hasOwn(continuation, 'hostConfirmationRequirement')
      || Object.hasOwn(continuation, 'approvalOrigin') || Object.hasOwn(continuation, 'hostExecutionCommit')) return invalid();
    const persistedRequirement = parseGoalLaunchHostRequirement(continuation.hostConfirmationRequirement);
    const persistedDisclosure = parseGoalLaunchDisclosureV1(payload.goalLaunchDisclosure);
    if (!equal(persistedRequirement, requirement) || !equal(persistedDisclosure, disclosure)) return invalid();
    const journal = tx.get<Row>(sql`SELECT id,session_id AS sessionId,turn_id AS turnId,revision,status,phase,completed_at AS completedAt
      FROM chat_runs WHERE id=${binding.parentRunId} AND session_id=${binding.parentSessionId} AND turn_id=${binding.parentTurnId}
      AND revision=${binding.parentWaitingRevision}`);
    abort();
    if (!journal || journal.id !== binding.parentRunId || journal.revision !== binding.parentWaitingRevision
      || journal.status !== 'waiting_for_human' || journal.phase !== 'tool_pending' || journal.completedAt !== null) return invalid();
    const prompt = tx.get<Row>(sql`SELECT id FROM messages WHERE id=${binding.promptMessageId} AND session_id=${binding.parentSessionId}
      AND turn_id=${binding.parentTurnId} AND role='user'`);
    abort();
    if (!prompt || prompt.id !== binding.promptMessageId) return invalid();
    const rows = tx.all<Row>(sql`SELECT id,prompt_message_id AS promptMessageId,tool_calls AS toolCalls,CAST(tool_calls AS BLOB) AS toolCallsBytes
      FROM messages WHERE session_id=${binding.parentSessionId} AND turn_id=${binding.parentTurnId} AND role='assistant'`);
    abort();
    let count = 0;
    let matched = false;
    for (const row of rows) {
      for (const call of readPersistedGoalLaunchCalls(row.toolCalls, row.toolCallsBytes)) {
        if (call.id !== requirement.callId) continue;
        count++;
        if (row.id === binding.assistantMessageId && row.promptMessageId === binding.promptMessageId
          && call.name === 'run_sub_agentflow' && equal(call.args, payload.args)
          && hashGoalLaunchJson(call.args) === binding.argsSha256 && call.args.goal === disclosure.goal) matched = true;
      }
    }
    if (count !== 1 || !matched) return invalid();
    abort();
  } catch {
    abort();
    return invalid();
  }
}
