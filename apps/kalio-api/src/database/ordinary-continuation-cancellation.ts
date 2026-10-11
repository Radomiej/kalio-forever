import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { ChatRunStatus } from '@kalio/types';
import { isProtectedGoalRequest } from '../common/goal-launch-request-family';
import { chatRuns, hitlRequests, messages, type ChatRunRow, type HitlRequestRow } from './schema';
import type { KalioDrizzleDatabase } from './sqlite-runtime';

export type OrdinaryCancellationDatabase = KalioDrizzleDatabase;
export type OrdinaryCancellationResult = 'committed' | 'conflict';
export interface OrdinaryCancellationBatchInput {
  sessionId: string;
  requests: readonly {
    requestId: string;
    expectedRequestRevision: number;
    expectedRun: { id: string; turnId: string; revision: number } | null;
    serializedToolResult: string | null;
  }[];
  expectedRunWithoutConfirmations?: { id: string; turnId: string; revision: number } | null;
}

type RunPick = NonNullable<OrdinaryCancellationBatchInput['expectedRunWithoutConfirmations']>;
const STOP_MESSAGE = 'Turn interrupted by user';
const CURRENT_STATUSES: ChatRunStatus[] = ['active', 'waiting_for_human', 'interrupted_needs_retry'];
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const revision = (value: unknown): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function dataFields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> | null {
  if (!record(value) || types.isProxy(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value); const keys = Reflect.ownKeys(descriptors);
  if (required.some(key => !Object.hasOwn(descriptors, key))) return null;
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (typeof key !== 'string' || (!required.includes(key) && !optional.includes(key))) return null;
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    result[key] = descriptor.value;
  }
  return result;
}
function detachRun(value: unknown): RunPick | null | undefined {
  if (value === null) return null;
  const run = dataFields(value, ['id', 'turnId', 'revision']);
  if (!run || !text(run['id']) || !text(run['turnId']) || !revision(run['revision'])) return undefined;
  return { id: run['id'], turnId: run['turnId'], revision: run['revision'] };
}
function detachInput(value: OrdinaryCancellationBatchInput): OrdinaryCancellationBatchInput | null {
  const root = dataFields(value, ['sessionId', 'requests'], ['expectedRunWithoutConfirmations']);
  if (!root || !text(root['sessionId'])) return null;
  const array = root['requests'];
  if (!array || typeof array !== 'object' || types.isProxy(array) || !Array.isArray(array)
    || Object.getPrototypeOf(array) !== Array.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors<object>(array); const keys = Reflect.ownKeys(descriptors);
  const length: unknown = descriptors['length']?.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) return null;
  const requests: OrdinaryCancellationBatchInput['requests'][number][] = [];
  const ids = new Set<string>();
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    const row = dataFields(descriptor.value, ['requestId', 'expectedRequestRevision', 'expectedRun', 'serializedToolResult']);
    if (!row || !text(row['requestId']) || ids.has(row['requestId']) || !revision(row['expectedRequestRevision'])
      || (row['serializedToolResult'] !== null && typeof row['serializedToolResult'] !== 'string')) return null;
    const run = detachRun(row['expectedRun']); if (run === undefined) return null;
    ids.add(row['requestId']);
    requests.push({ requestId: row['requestId'], expectedRequestRevision: row['expectedRequestRevision'],
      expectedRun: run, serializedToolResult: row['serializedToolResult'] });
  }
  const emptyRun = detachRun(root['expectedRunWithoutConfirmations'] ?? null);
  if (emptyRun === undefined || (requests.length > 0 && emptyRun !== null)) return null;
  return { sessionId: root['sessionId'], requests, expectedRunWithoutConfirmations: emptyRun };
}

/** Pending-only session batch, not Stop authorization or durable retry-origin proof.
 * Every pending tool-confirmation row must be selected; protected rows are always rejected.
 * No Chat imports, generic upserts, markers or await/external callbacks inside the transaction. */
export function commitOrdinaryContinuationCancellationBatch(db: OrdinaryCancellationDatabase,
  raw: OrdinaryCancellationBatchInput): OrdinaryCancellationResult {
  let input: OrdinaryCancellationBatchInput | null;
  try { input = detachInput(raw); } catch { return 'conflict'; }
  if (!input) return 'conflict';
  const selected = input;
  let conflict = false;
  function reject(): never { conflict = true; throw new Error('ORDINARY_CANCELLATION_CONFLICT'); }
  try {
    return db.transaction(tx => {
      const pendingScope = and(eq(hitlRequests.sessionId, selected.sessionId), eq(hitlRequests.kind, 'tool_confirmation'),
        eq(hitlRequests.status, 'pending'));
      const pending = tx.select().from(hitlRequests).where(pendingScope).all();
      const selectors = new Map(selected.requests.map(request => [request.requestId, request]));
      if (pending.length !== selectors.size || pending.some(row => !selectors.has(row.id) || isProtectedGoalRequest(row))) reject();
      // Same durable admission-order predicate as journal recovery; heartbeats are not admission.
      const currentAdmission = sql`NOT EXISTS (
        SELECT 1 FROM chat_runs AS newer WHERE newer.session_id = chat_runs.session_id
          AND newer.turn_id <> chat_runs.turn_id AND (newer.queued_at IS NULL OR newer.queue_claimed_at IS NOT NULL)
          AND (COALESCE(newer.queue_claimed_at, newer.started_at) > COALESCE(chat_runs.queue_claimed_at, chat_runs.started_at)
            OR (COALESCE(newer.queue_claimed_at, newer.started_at) = COALESCE(chat_runs.queue_claimed_at, chat_runs.started_at)
              AND newer.rowid > chat_runs.rowid)))`;
      const journals = new Map<string, { pick: RunPick; row: ChatRunRow }>();
      function registerRun(pick: RunPick): void {
        const existing = journals.get(pick.id);
        if (existing) {
          if (existing.pick.turnId !== pick.turnId || existing.pick.revision !== pick.revision) reject();
          return;
        }
        const row = tx.select().from(chatRuns).where(and(eq(chatRuns.id, pick.id), eq(chatRuns.sessionId, selected.sessionId),
          eq(chatRuns.turnId, pick.turnId), eq(chatRuns.revision, pick.revision), inArray(chatRuns.status, CURRENT_STATUSES), currentAdmission)).get();
        if (!row) reject();
        journals.set(pick.id, { pick, row });
      }
      const plans: { request: HitlRequestRow; content: string | null; prompt: string | null; messageId: string | null }[] = [];
      const calls = new Set<string>();
      for (const request of pending) {
        const item = selectors.get(request.id);
        if (!item || request.revision !== item.expectedRequestRevision || request.outcome !== null) reject();
        const cursor = request.continuation;
        if (cursor !== null && !record(cursor)) reject();
        for (const [key, expected] of [['sessionId', request.sessionId], ['runId', request.runId], ['turnId', request.turnId]] as const) {
          if (cursor && Object.hasOwn(cursor, key) && cursor[key] !== expected) reject();
        }
        if (cursor && (Object.hasOwn(cursor, 'approvalOrigin') || Object.hasOwn(cursor, 'hostExecutionCommit')
          || (Object.hasOwn(cursor, 'executionState') && cursor['executionState'] !== 'pending'))) reject();
        const prompt = cursor?.['promptMessageId'] ?? null;
        if (prompt !== null && !text(prompt)) reject();
        const hasRun = request.runId !== null; const hasTurn = request.turnId !== null;
        if (hasRun !== hasTurn || (hasRun && (!text(request.runId) || !text(request.turnId)))) reject();
        const expectedRun = item.expectedRun;
        if (hasRun ? !expectedRun || expectedRun.id !== request.runId || expectedRun.turnId !== request.turnId : expectedRun !== null) reject();
        if (expectedRun) registerRun(expectedRun);
        const toolName = record(request.payload) ? request.payload['toolName'] : undefined;
        const callId = request.toolCallId; const writesMessage = Boolean(callId) && typeof toolName === 'string';
        // Chat supplies known cancellation serialization; validate exact bytes against this persisted call/name source.
        if (writesMessage ? item.serializedToolResult !== JSON.stringify({ status: 'cancelled', errorMessage: STOP_MESSAGE })
          : item.serializedToolResult !== null) reject();
        const messageId = writesMessage ? 'ordinary-cancellation-' + createHash('sha256')
          .update(JSON.stringify([request.id, request.sessionId, callId]), 'utf8').digest('hex') : null;
        if (messageId && callId) {
          if (calls.has(callId)) reject(); calls.add(callId);
          if (tx.select({ id: messages.id }).from(messages).where(or(eq(messages.id, messageId),
            and(eq(messages.sessionId, request.sessionId), eq(messages.role, 'tool_result'), eq(messages.toolCallId, callId)))).get()) reject();
        }
        plans.push({ request, content: item.serializedToolResult, prompt, messageId });
      }
      if (selected.requests.length === 0 && selected.expectedRunWithoutConfirmations) registerRun(selected.expectedRunWithoutConfirmations);
      const now = new Date();
      for (const plan of plans) {
        const request = plan.request;
        const changed = tx.update(hitlRequests).set({ status: 'cancelled', outcome: { message: STOP_MESSAGE },
          revision: sql`${hitlRequests.revision} + 1`, updatedAt: now, resolvedAt: now,
        }).where(and(eq(hitlRequests.id, request.id), eq(hitlRequests.sessionId, selected.sessionId), eq(hitlRequests.kind, 'tool_confirmation'),
          eq(hitlRequests.status, 'pending'), eq(hitlRequests.revision, request.revision))).run();
        if (changed.changes !== 1) reject();
        if (plan.messageId !== null && plan.content !== null) {
          tx.insert(messages).values({ id: plan.messageId, sessionId: selected.sessionId, role: 'tool_result', content: plan.content,
            toolCallId: request.toolCallId, turnId: request.turnId, promptMessageId: plan.prompt, createdAt: now }).run();
        }
      }
      for (const { pick } of journals.values()) {
        const interrupted = tx.update(chatRuns).set({ phase: 'interrupted', status: 'interrupted',
          revision: sql`${chatRuns.revision} + 1`, safeResume: false, errorCode: 'INTERRUPTED', errorMessage: STOP_MESSAGE,
          updatedAt: now, lastHeartbeatAt: now, completedAt: now,
        }).where(and(eq(chatRuns.id, pick.id), eq(chatRuns.sessionId, selected.sessionId), eq(chatRuns.turnId, pick.turnId),
          eq(chatRuns.revision, pick.revision), inArray(chatRuns.status, CURRENT_STATUSES), currentAdmission)).run();
        if (interrupted.changes !== 1) reject();
      }
      // Read every destination after all writes, so a later write cannot invalidate an earlier readback.
      for (const { row } of journals.values()) {
        const finalRun = tx.select().from(chatRuns).where(eq(chatRuns.id, row.id)).get();
        if (JSON.stringify(finalRun) !== JSON.stringify({ ...row, phase: 'interrupted', status: 'interrupted',
          revision: row.revision + 1, safeResume: false, errorCode: 'INTERRUPTED', errorMessage: STOP_MESSAGE,
          updatedAt: now, lastHeartbeatAt: now, completedAt: now })) throw new Error('readback');
      }
      for (const plan of plans) {
        const request = plan.request;
        const finalRequest = tx.select().from(hitlRequests).where(eq(hitlRequests.id, request.id)).get();
        if (JSON.stringify(finalRequest) !== JSON.stringify({ ...request, status: 'cancelled', outcome: { message: STOP_MESSAGE },
          revision: request.revision + 1, updatedAt: now, resolvedAt: now })) throw new Error('readback');
        if (plan.messageId !== null) {
          const message = tx.select().from(messages).where(eq(messages.id, plan.messageId)).get();
          if (!message || message.sessionId !== selected.sessionId || message.role !== 'tool_result'
            || message.toolCallId !== request.toolCallId || message.content !== plan.content || message.turnId !== request.turnId
            || message.promptMessageId !== plan.prompt || message.createdAt.getTime() !== now.getTime()
            || message.thinking !== null || message.toolCalls !== null || message.attachments !== null) throw new Error('readback');
        }
      }
      if (tx.select({ id: hitlRequests.id }).from(hitlRequests).where(pendingScope).get()) reject();
      return 'committed';
    }, { behavior: 'immediate' });
  } catch {
    if (conflict) return 'conflict';
    throw new Error('ORDINARY_CANCELLATION_STORAGE_FAILED');
  }
}
