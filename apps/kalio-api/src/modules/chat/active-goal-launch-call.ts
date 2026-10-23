import type { KalioDrizzleDatabase } from '../../database/sqlite-runtime';
import { sql } from 'drizzle-orm';
import { types } from 'node:util';
import { createHash } from 'node:crypto';
import type { LLMToolCall } from '@kalio/types';
import { detachHostReceiptArgs } from './llm-turn-runtime-dispatch';
import { readPersistedGoalLaunchCalls } from '../../common/goal-launch-persisted-call';

export interface ActiveGoalLaunchCallLocator {
  runId: string;
  sessionId: string;
  turnId: string;
  promptMessageId: string;
  assistantMessageId: string;
  callId: string;
  expectedRevision: number;
  actualArgs: Record<string, unknown>;
}
export interface ActiveGoalLaunchCallRecord {
  readonly runId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly promptMessageId: string;
  readonly assistantMessageId: string;
  readonly revision: number;
  readonly status: 'active';
  readonly phase: 'tool_running';
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly lastHeartbeatAt: number;
  readonly promptCreatedAt: number;
  readonly assistantCreatedAt: number;
  readonly call: Readonly<LLMToolCall>;
  /** Exact persisted assistant tool_calls bytes, NOT an execution receipt. */
  readonly toolCallsSha256: string;
  readonly toolCallsUtf8Bytes: number;
}
type RawRow = Record<string, unknown>;
const fail = (code: string): never => { throw new Error(`ACTIVE_GOAL_LAUNCH_${code}`); };
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function timestamp(value: unknown): number {
  if (!positive(value) || value > 8640000000000000) return fail('CORRUPT');
  return value;
}
function json(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === undefined) return fail('INVALID');
    return item;
  });
}
function checkedLocator(value: ActiveGoalLaunchCallLocator): ActiveGoalLaunchCallLocator {
  try {
    const keys = ['runId', 'sessionId', 'turnId', 'promptMessageId', 'assistantMessageId', 'callId', 'expectedRevision', 'actualArgs'];
    if (!value || typeof value !== 'object' || types.isProxy(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail('INVALID');
    const own = Reflect.ownKeys(value);
    if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) return fail('INVALID');
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail('INVALID');
    }
    const detached = detachHostReceiptArgs(value as unknown as Record<string, unknown>);
    if (!keys.slice(0, 6).every(key => nonempty(detached[key])) || !positive(detached.expectedRevision)
      || !detached.actualArgs || typeof detached.actualArgs !== 'object' || Array.isArray(detached.actualArgs)) return fail('INVALID');
    json(detached);
    return detached as unknown as ActiveGoalLaunchCallLocator;
  } catch { return fail('INVALID'); }
}
function calls(row: RawRow): readonly LLMToolCall[] {
  try {
    return readPersistedGoalLaunchCalls(row.toolCalls, row.toolCallsBytes);
  } catch { return fail('CORRUPT'); }
}

/** Persistence linkage only. Caller still owns live entry, HITL, Stop fencing and durable launch ACK. */
export async function readActiveLaunchCallExact(db: KalioDrizzleDatabase,
  locator: ActiveGoalLaunchCallLocator, signal?: AbortSignal): Promise<ActiveGoalLaunchCallRecord | null> {
  const abort = (): void => { if (signal?.aborted) fail('ABORTED'); };
  abort();
  const key = checkedLocator(locator);
  try {
    const result = db.transaction(tx => {
      abort();
      const journal = tx.get<RawRow>(sql`SELECT id,session_id AS sessionId,turn_id AS turnId,revision,status,phase,
        started_at AS startedAt,updated_at AS updatedAt,last_heartbeat_at AS lastHeartbeatAt,completed_at AS completedAt
        FROM chat_runs WHERE id=${key.runId} AND session_id=${key.sessionId} AND turn_id=${key.turnId} AND revision=${key.expectedRevision}`);
      abort();
      if (!journal) return null;
      if (!['queued','active','waiting_for_human','completed','failed','cancelled','interrupted','interrupted_needs_retry'].includes(String(journal.status))
        || !['queued','started','llm_streaming','tool_pending','tool_running','completed','interrupted','failed'].includes(String(journal.phase))) return fail('CORRUPT');
      if (journal.status !== 'active' || journal.phase !== 'tool_running' || journal.completedAt !== null) return null;
      const startedAt = timestamp(journal.startedAt), updatedAt = timestamp(journal.updatedAt), lastHeartbeatAt = timestamp(journal.lastHeartbeatAt);
      const prompt = tx.get<RawRow>(sql`SELECT created_at AS createdAt FROM messages WHERE id=${key.promptMessageId}
        AND session_id=${key.sessionId} AND turn_id=${key.turnId} AND role='user'`);
      abort();
      if (!prompt) return null;
      const promptCreatedAt = timestamp(prompt.createdAt);
      const rows = tx.all<RawRow>(sql`SELECT id,tool_calls AS toolCalls,CAST(tool_calls AS BLOB) AS toolCallsBytes,created_at AS createdAt
        FROM messages WHERE session_id=${key.sessionId} AND turn_id=${key.turnId} AND prompt_message_id=${key.promptMessageId} AND role='assistant'`);
      abort();
      let selected: { row: RawRow; call: LLMToolCall } | undefined;
      let count = 0;
      for (const row of rows) {
        timestamp(row.createdAt);
        for (const call of calls(row)) if (call.id === key.callId) {
          count++;
          if (row.id === key.assistantMessageId) selected = { row, call };
        }
      }
      if (count > 1) return fail('AMBIGUOUS');
      if (!selected || selected.call.name !== 'run_sub_agentflow' || json(selected.call.args) !== json(key.actualArgs)) return null;
      const bytes = Buffer.from(selected.row.toolCallsBytes as Uint8Array);
      abort();
      return Object.freeze({ runId: key.runId, sessionId: key.sessionId, turnId: key.turnId,
        promptMessageId: key.promptMessageId, assistantMessageId: key.assistantMessageId,
        revision: key.expectedRevision, status: 'active' as const, phase: 'tool_running' as const,
        startedAt, updatedAt, lastHeartbeatAt, promptCreatedAt, assistantCreatedAt: timestamp(selected.row.createdAt),
        call: selected.call, toolCallsSha256: createHash('sha256').update(bytes).digest('hex'), toolCallsUtf8Bytes: bytes.length });
    });
    abort();
    return result;
  } catch (error) {
    abort();
    if (error instanceof Error && /^ACTIVE_GOAL_LAUNCH_(CORRUPT|AMBIGUOUS|ABORTED)$/.test(error.message)) throw error;
    return fail('STORAGE_ERROR');
  }
}
