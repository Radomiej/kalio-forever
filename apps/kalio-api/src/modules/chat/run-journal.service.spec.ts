import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { RunJournalService } from './run-journal.service';

function makeService(): RunJournalService {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE chat_runs (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      status TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      runtime_kind TEXT,
      execution_profile_id TEXT,
      external_thread_id TEXT,
      external_turn_id TEXT,
      process_epoch TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      retry_count INTEGER NOT NULL DEFAULT 0,
      safe_resume INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      queue_idempotency_key TEXT,
      queued_payload TEXT,
      queued_at INTEGER,
      queue_claimed_at INTEGER,
      queue_cancelled_at INTEGER,
      outcome TEXT,
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_heartbeat_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX chat_runs_session_status_queued_at_idx ON chat_runs (session_id, status, queued_at);
    CREATE UNIQUE INDEX chat_runs_session_queue_idempotency_key_idx ON chat_runs (session_id, queue_idempotency_key);
  `);

  const drizzleService = new DrizzleService(null as never);
  (drizzleService as unknown as { db: unknown }).db = drizzle(sqlite, { schema });
  return new RunJournalService(drizzleService);
}

describe('RunJournalService', () => {
  let service: RunJournalService;

  beforeEach(() => {
    service = makeService();
  });

  afterEach(() => vi.useRealTimers());

  it('reads selected durable outcomes from one session, including cancellation, without foreign matches', async () => {
    const own = await service.startRun({ sessionId: 'own', turnId: 'same' });
    await service.checkpoint(own.id, { status: 'cancelled', phase: 'interrupted' });
    await service.startRun({ sessionId: 'foreign', turnId: 'same' });
    await service.startRun({ sessionId: 'own', turnId: 'unselected' });
    expect(await service.getHistoryTurns('own', ['same', 'same'])).toEqual([
      expect.objectContaining({ id: own.id, sessionId: 'own', turnId: 'same', status: 'cancelled' }),
    ]);
    expect(await service.getHistoryTurns('own', [])).toEqual([]);
    expect(await service.getHistoryTurns('own', ['missing'])).toEqual([]);
  });

  it('does not project or automatically claim a safe interrupted turn after a newer turn completed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T20:00:00Z'));
    const old = await service.startRun({ sessionId: 's1', turnId: 'old' });
    await service.recoverStaleActiveRuns();
    const interrupted = await service.getCurrentRun('s1');
    const newer = await service.startRun({ sessionId: 's1', turnId: 'newer' });
    await service.complete(newer.id, { finalText: 'completed continuation' });
    vi.setSystemTime(new Date('2026-10-02T20:01:00Z'));
    await service.checkpoint(old.id, { phase: 'llm_streaming' });
    expect(await service.getCurrentRun('s1')).toBeNull();
    expect(await service.listSafeRecoverableRuns()).toEqual([]);
    expect(await service.claimChildContinuation(old.id, (interrupted?.revision ?? 0) + 1)).toBe(false);
  });

  it('does not supersede a safe interrupted turn merely because a new turn is queued', async () => {
    const old = await service.startRun({ sessionId: 's1', turnId: 'old' });
    await service.recoverStaleActiveRuns();
    await service.acceptQueuedRun({
      sessionId: 's1', turnId: 'queued', queueIdempotencyKey: 'queue-1',
      queuedPayload: { personaId: 'default', content: 'Continue' },
    });
    expect(await service.getCurrentRun('s1')).toMatchObject({ id: old.id, safeResume: true });
    expect(await service.listSafeRecoverableRuns()).toHaveLength(1);
  });

  it('keeps an unresolved unsafe interrupted tool visible after a newer turn completes', async () => {
    const old = await service.startRun({ sessionId: 's1', turnId: 'old' });
    await service.checkpoint(old.id, { phase: 'tool_running' });
    await service.recoverStaleActiveRuns();
    const newer = await service.startRun({ sessionId: 's1', turnId: 'newer' });
    await service.complete(newer.id, { finalText: 'new response' });
    expect(await service.getCurrentRun('s1')).toMatchObject({ id: old.id, safeResume: false });
    expect(await service.listSafeRecoverableRuns()).toEqual([]);
  });

  it('keeps a human wait visible when a newer separate turn completed', async () => {
    const waiting = await service.startRun({ sessionId: 's1', turnId: 'waiting' });
    await service.checkpoint(waiting.id, { phase: 'tool_pending', status: 'waiting_for_human' });
    const newer = await service.startRun({ sessionId: 's1', turnId: 'newer' });
    await service.complete(newer.id);
    expect(await service.getCurrentRun('s1')).toMatchObject({ id: waiting.id, status: 'waiting_for_human' });
  });

  it('does not supersede recovery when queued work is cancelled before execution', async () => {
    const old = await service.startRun({ sessionId: 's1', turnId: 'old' });
    await service.recoverStaleActiveRuns();
    const queued = await service.acceptQueuedRun({
      sessionId: 's1', turnId: 'queued', queueIdempotencyKey: 'cancelled-queue',
      queuedPayload: { personaId: 'default', content: 'Continue' },
    });
    await service.cancelQueuedRun(queued.id);
    expect(await service.getCurrentRun('s1')).toMatchObject({ id: old.id, safeResume: true });
    expect(await service.listSafeRecoverableRuns()).toHaveLength(1);
  });

  it('uses queue admission time rather than queue insertion time to supersede a safe turn', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T20:00:00Z'));
    const queued = await service.acceptQueuedRun({
      sessionId: 's1', turnId: 'queued', queueIdempotencyKey: 'admitted-queue',
      queuedPayload: { personaId: 'default', content: 'Continue' },
    });
    vi.setSystemTime(new Date('2026-10-02T20:01:00Z'));
    await service.startRun({ sessionId: 's1', turnId: 'old' });
    await service.recoverStaleActiveRuns();
    const old = await service.getCurrentRun('s1');
    vi.setSystemTime(new Date('2026-10-02T20:02:00Z'));
    expect(await service.claimQueuedRun('s1')).toMatchObject({ id: queued.id });
    await service.complete(queued.id);
    expect(await service.getCurrentRun('s1')).toBeNull();
    expect(await service.listSafeRecoverableRuns()).toEqual([]);
    expect(await service.claimChildContinuation(old!.id, old!.revision ?? 0)).toBe(false);
  });

  it('does not treat a journal row of the same turn as distinct superseding work', async () => {
    await service.startRun({ sessionId: 's1', turnId: 'same' });
    await service.recoverStaleActiveRuns();
    const old = await service.getCurrentRun('s1');
    const sibling = await service.startRun({ sessionId: 's1', turnId: 'same' });
    await service.complete(sibling.id);
    expect(await service.getCurrentRun('s1')).toMatchObject({ id: old!.id });
    expect(await service.claimChildContinuation(old!.id, old!.revision ?? 0)).toBe(true);
  });

  it('marks stale LLM runs as resumable after restart', async () => {
    const run = await service.startRun({
      sessionId: 's1',
      turnId: 't1',
      provider: 'openai',
      model: 'gpt-4.1-mini',
    });
    await service.checkpoint(run.id, { phase: 'llm_streaming' });

    await service.recoverStaleActiveRuns();

    await expect(service.getCurrentRun('s1')).resolves.toMatchObject({
      id: run.id,
      sessionId: 's1',
      turnId: 't1',
      phase: 'llm_streaming',
      status: 'interrupted_needs_retry',
      safeResume: true,
      errorCode: 'BACKEND_RESTART',
    });
  });

  it('marks stale tool runs as interrupted without safe resume', async () => {
    const run = await service.startRun({ sessionId: 's1', turnId: 't1' });
    await service.checkpoint(run.id, { phase: 'tool_running' });

    await service.recoverStaleActiveRuns();

    await expect(service.getCurrentRun('s1')).resolves.toMatchObject({
      status: 'interrupted_needs_retry',
      safeResume: false,
      errorMessage: 'Backend restarted while a tool was running. Retry manually to avoid duplicate tool execution.',
    });
  });

  it('recovers an approved human wait as unsafe once execution is active', async () => {
    const run = await service.startRun({ sessionId: 'approved-session', turnId: 'approved-turn' });
    await service.checkpoint(run.id, { phase: 'tool_pending', status: 'waiting_for_human' });
    await service.checkpoint(run.id, { phase: 'tool_running', status: 'active' });
    expect(await service.getCurrentRun('approved-session')).toMatchObject({ phase: 'tool_running', status: 'active' });
    await service.recoverStaleActiveRuns();
    expect(await service.getCurrentRun('approved-session')).toMatchObject({ status: 'interrupted_needs_retry', safeResume: false });
  });

  it('stores a terminal outcome while removing the run from the active projection', async () => {
    const run = await service.startRun({ sessionId: 's1', turnId: 't1' });
    await service.interrupt(run.id, 'Backend restarted.');
    const completedRuns: string[] = [];
    service.subscribeCompleted((completed) => {
      completedRuns.push(completed.id);
    });
    await service.complete(run.id, {
      finalText: 'durable result',
      structuredOutput: { decision: 'continue' },
      messageId: 'message-1',
    });

    await expect(service.getCurrentRun('s1')).resolves.toBeNull();
    expect(completedRuns).toEqual([run.id]);
    await expect(service.getCompletedTurn('s1', 't1')).resolves.toMatchObject({
      status: 'completed',
      errorCode: undefined,
      errorMessage: undefined,
      outcome: {
        finalText: 'durable result',
        structuredOutput: { decision: 'continue' },
        messageId: 'message-1',
      },
    });
  });

  it('increments the durable revision for every state transition', async () => {
    const run = await service.startRun({ sessionId: 's1', turnId: 't1' });
    expect(run.revision).toBe(1);

    await service.checkpoint(run.id, { phase: 'llm_streaming' });

    await expect(service.getCurrentRun('s1')).resolves.toMatchObject({
      id: run.id,
      revision: 2,
      phase: 'llm_streaming',
    });
  });

  it('keeps a human wait current across journal recovery', async () => {
    const run = await service.startRun({ sessionId: 's1', turnId: 't1' });
    await service.checkpoint(run.id, {
      phase: 'tool_pending',
      status: 'waiting_for_human',
    });

    await expect(service.getCurrentRun('s1')).resolves.toMatchObject({
      id: run.id,
      phase: 'tool_pending',
      status: 'waiting_for_human',
    });

    await service.recoverStaleActiveRuns();

    await expect(service.getCurrentRun('s1')).resolves.toMatchObject({
      id: run.id,
      phase: 'tool_pending',
      status: 'waiting_for_human',
    });
  });

  it('atomically claims one safe child continuation by durable revision', async () => {
    const run = await service.startRun({ sessionId: 'parent', turnId: 'parent-turn' });
    await service.checkpoint(run.id, { phase: 'llm_streaming' });
    await service.recoverStaleActiveRuns();
    const recoverable = await service.getCurrentRun('parent');
    expect(recoverable).toMatchObject({ status: 'interrupted_needs_retry', safeResume: true });
    await expect(service.listSafeRecoverableRuns()).resolves.toEqual([
      expect.objectContaining({ id: run.id, revision: recoverable!.revision }),
    ]);

    await expect(service.claimChildContinuation(run.id, recoverable!.revision!)).resolves.toBe(true);
    await expect(service.claimChildContinuation(run.id, recoverable!.revision!)).resolves.toBe(false);
    await expect(service.getCurrentRun('parent')).resolves.toMatchObject({
      status: 'active',
      phase: 'llm_streaming',
      safeResume: true,
      errorCode: undefined,
    });
  });

  it('returns the latest durable completed child outcome for bootstrap replay', async () => {
    const first = await service.startRun({ sessionId: 'child', turnId: 'child-turn-1' });
    await service.complete(first.id, { finalText: 'first' });
    const latest = await service.startRun({ sessionId: 'child', turnId: 'child-turn-2' });
    await service.complete(latest.id, { finalText: 'latest' });

    await expect(service.getLatestCompletedForSession('child')).resolves.toMatchObject({
      id: latest.id,
      outcome: { finalText: 'latest' },
    });
  });

  it('selects failed, cancelled, and terminal interrupted turns as non-replayable LLM history', async () => {
    const failed = await service.startRun({ sessionId: 's1', turnId: 'turn-failed' });
    await service.fail(failed.id, 'PROVIDER_UNAVAILABLE', 'unavailable');
    const interrupted = await service.startRun({ sessionId: 's1', turnId: 'turn-interrupted' });
    await service.interrupt(interrupted.id, 'stopped');
    const cancelled = await service.startRun({ sessionId: 's2', turnId: 'turn-cancelled' });
    await service.checkpoint(cancelled.id, { status: 'cancelled' });
    const completed = await service.startRun({ sessionId: 's1', turnId: 'turn-completed' });
    await service.complete(completed.id, { finalText: 'ok' });
    await service.startRun({ sessionId: 's1', turnId: 'turn-current' });

    await expect(service.getNonReplayableTurnIds(['s1', 's2'])).resolves.toEqual(new Set([
      'turn-failed',
      'turn-interrupted',
      'turn-cancelled',
    ]));
  });

  it('accepts queued runs idempotently by session and queue key', async () => {
    const first = await service.acceptQueuedRun({
      sessionId: 's1',
      turnId: 'queued-turn-1',
      queueIdempotencyKey: 'queue-key-1',
      queuedPayload: {
        content: 'queued one',
        personaId: 'persona-1',
        clientMessageId: 'client-1',
      },
    });

    const second = await service.acceptQueuedRun({
      sessionId: 's1',
      turnId: 'queued-turn-1-duplicate',
      queueIdempotencyKey: 'queue-key-1',
      queuedPayload: {
        content: 'queued one duplicate',
        personaId: 'persona-1',
      },
    });

    expect(second).toMatchObject({
      id: first.id,
      turnId: 'queued-turn-1',
      status: 'queued',
      phase: 'queued',
      queueIdempotencyKey: 'queue-key-1',
      queuedPayload: {
        content: 'queued one',
        personaId: 'persona-1',
        clientMessageId: 'client-1',
      },
    });
  });

  it('lists queued runs in durable FIFO order and claims the oldest first', async () => {
    const first = await service.acceptQueuedRun({
      sessionId: 's1',
      turnId: 'queued-turn-1',
      queueIdempotencyKey: 'queue-key-1',
      queuedPayload: { content: 'first', personaId: 'persona-1' },
    });
    const second = await service.acceptQueuedRun({
      sessionId: 's1',
      turnId: 'queued-turn-2',
      queueIdempotencyKey: 'queue-key-2',
      queuedPayload: { content: 'second', personaId: 'persona-1' },
    });

    await expect(service.listQueuedRuns('s1')).resolves.toMatchObject([
      { id: first.id, turnId: 'queued-turn-1', status: 'queued' },
      { id: second.id, turnId: 'queued-turn-2', status: 'queued' },
    ]);

    const claimed = await service.claimQueuedRun('s1');
    expect(claimed).toMatchObject({
      id: first.id,
      status: 'active',
      phase: 'started',
      revision: 2,
      queueClaimedAt: expect.any(Number),
    });

    await expect(service.listQueuedRuns('s1')).resolves.toMatchObject([
      { id: second.id, turnId: 'queued-turn-2', status: 'queued' },
    ]);
  });

  it('uses revision CAS so a queued run can only be cancelled once', async () => {
    const queued = await service.acceptQueuedRun({
      sessionId: 's1',
      turnId: 'queued-turn-1',
      queueIdempotencyKey: 'queue-key-1',
      queuedPayload: { content: 'first', personaId: 'persona-1' },
    });

    await expect(service.cancelQueuedRun(queued.id, queued.revision)).resolves.toBe(true);
    await expect(service.cancelQueuedRun(queued.id, queued.revision)).resolves.toBe(true);
    await expect(service.listQueuedRuns('s1')).resolves.toEqual([]);
    await expect(service.getTurn('s1', 'queued-turn-1')).resolves.toMatchObject({
      id: queued.id,
      status: 'cancelled',
      phase: 'queued',
      revision: 2,
      queueCancelledAt: expect.any(Number),
    });
  });

  it('returns null when a session has no queued work left to claim', async () => {
    await expect(service.claimQueuedRun('missing-session')).resolves.toBeNull();
  });
});
