import { beforeEach, describe, expect, it } from 'vitest';
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
