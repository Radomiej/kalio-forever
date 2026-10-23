import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { RunJournalService } from './run-journal.service';

function makeFixture() {
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
  return { service: new RunJournalService(drizzleService), sqlite, db: drizzleService.db };
}

function makeService(): RunJournalService { return makeFixture().service; }

describe('RunJournalService completeRequired', () => {
  it.each(['root-getter', 'nested-getter', 'toJSON', 'nested-toJSON', 'toJSON-getter', 'array-getter', 'proxy'])('rejects %s without executing user code or entering transaction', async kind => {
    const { service, sqlite, db } = makeFixture();
    try {
      const run = await service.startRun({ sessionId: 's', turnId: 't' });
      const before = await service.getTurn('s', 't');
      let getterCount = 0;
      let toJSONCount = 0;
      const outcome: Record<string, unknown> = { finalText: 'original', structuredOutput: {} };
      if (kind === 'root-getter') Object.defineProperty(outcome, 'finalText', { enumerable: true, get: () => { getterCount++; return 'rewritten'; } });
      if (kind === 'nested-getter') Object.defineProperty(outcome['structuredOutput'], 'answer', { enumerable: true, get: () => { getterCount++; return true; } });
      if (kind === 'toJSON') outcome['toJSON'] = () => { toJSONCount++; return { finalText: 'rewritten' }; };
      if (kind === 'nested-toJSON') outcome['structuredOutput'] = { toJSON: () => { toJSONCount++; return { rewritten: true }; } };
      if (kind === 'toJSON-getter') Object.defineProperty(outcome['structuredOutput'], 'toJSON', { enumerable: true, get: () => { getterCount++; return () => { toJSONCount++; return true; }; } });
      if (kind === 'array-getter') {
        const data = [1];
        Object.defineProperty(data, '0', { enumerable: true, get: () => { getterCount++; return 2; } });
        outcome['structuredOutput'] = data;
      }
      if (kind === 'proxy') outcome['structuredOutput'] = new Proxy({}, { getPrototypeOf: () => { getterCount++; return Object.prototype; }, ownKeys: () => { getterCount++; return []; } });
      const transaction = vi.spyOn(db, 'transaction');
      const listener = vi.fn();
      service.subscribeCompleted(listener);
      await expect(Reflect.apply(service.completeRequired, service, [run.id, 1, outcome])).rejects.toThrow('RUN_COMPLETION_INVALID');
      expect(getterCount).toBe(0);
      expect(toJSONCount).toBe(0);
      expect(transaction).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
      expect(await service.getTurn('s', 't')).toEqual(before);
      transaction.mockRestore();
    } finally { sqlite.close(); }
  });
  it.each([
    ['custom prototype', () => Object.create({ inherited: true })], ['date', () => new Date()],
    ['symbol key', () => ({ [Symbol('private')]: 1 })], ['symbol value', () => Symbol('private')],
    ['nonfinite', () => ({ answer: NaN })], ['infinity', () => [Infinity]],
    ['sparse', () => new Array(2)], ['function', () => ({ answer: () => true })],
    ['nested undefined', () => ({ answer: undefined })], ['array undefined', () => [undefined]],
    ['array extra field', () => Object.assign([1], { extra: true })],
    ['nonenumerable', () => Object.defineProperty({}, 'secret', { value: 1 })],
    ['cycle', () => { const value: Record<string, unknown> = {}; value['self'] = value; return value; }],
  ] as const)('rejects lossy/non-plain JSON: %s before transaction', async (_label, create) => {
    const { service, sqlite, db } = makeFixture();
    try {
      const run = await service.startRun({ sessionId: 's', turnId: 't' });
      const before = await service.getTurn('s', 't');
      const transaction = vi.spyOn(db, 'transaction');
      await expect(service.completeRequired(run.id, 1, { finalText: 'original', structuredOutput: create() })).rejects.toThrow('RUN_COMPLETION_INVALID');
      expect(transaction).not.toHaveBeenCalled();
      expect(await service.getTurn('s', 't')).toEqual(before);
      transaction.mockRestore();
    } finally { sqlite.close(); }
  });
  it('preserves omitted/undefined optional outcome fields and safe plain JSON exactly', async () => {
    const { service, sqlite } = makeFixture();
    try {
      const run = await service.startRun({ sessionId: 's', turnId: 't' });
      const receipt = await service.completeRequired(run.id, 1, { finalText: '', messageId: undefined, structuredOutput: undefined });
      expect(receipt.outcome).toEqual({ finalText: '' });
      const next = await service.startRun({ sessionId: 's', turnId: 'next' });
      const data = Object.create(null) as Record<string, unknown>;
      data['__proto__'] = { answer: 'literal' };
      data['values'] = [null, false, 1.25, 'text', { toJSON: 'literal' }];
      const safe = await service.completeRequired(next.id, 1, { finalText: 'text', structuredOutput: data });
      expect(safe.outcome?.structuredOutput).toEqual(data);
    } finally { sqlite.close(); }
  });
  it('returns the actual committed snapshot and notifies listeners only after commit', async () => {
    const { service, sqlite } = makeFixture();
    try {
      const run = await service.startRun({ sessionId: 's', turnId: 't' });
      await service.checkpoint(run.id, { safeResume: true, errorCode: 'old', errorMessage: 'old' });
      const listener = vi.fn(() => {
        expect(sqlite.inTransaction).toBe(false);
        expect(sqlite.prepare('SELECT status, revision FROM chat_runs WHERE id = ?').get(run.id)).toEqual({ status: 'completed', revision: 3 });
      });
      service.subscribeCompleted(listener);
      const outcome = { finalText: 'Done', messageId: 'actual-message', structuredOutput: { answer: true } };
      const result = await service.completeRequired(run.id, 2, outcome);
      expect(result).toEqual(await service.getTurn('s', 't'));
      expect(result).toMatchObject({ id: run.id, sessionId: 's', turnId: 't', phase: 'completed', status: 'completed', revision: 3,
        safeResume: false, outcome, completedAt: expect.any(Number) });
      expect(result.errorCode).toBeUndefined();
      expect(result.errorMessage).toBeUndefined();
      expect(listener).toHaveBeenCalledTimes(1);
      outcome.structuredOutput.answer = false;
      expect(result.outcome?.structuredOutput).toEqual({ answer: true });
    } finally { sqlite.close(); }
  });
  it('allows only one competing CAS and rejects stale/missing identities without notifications', async () => {
    const { service, sqlite } = makeFixture();
    try {
      const run = await service.startRun({ sessionId: 's', turnId: 't' });
      const listener = vi.fn();
      service.subscribeCompleted(listener);
      const results = await Promise.allSettled([service.completeRequired(run.id, 1, { finalText: 'A' }), service.completeRequired(run.id, 1, { finalText: 'B' })]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
      expect(listener).toHaveBeenCalledTimes(1);
      await expect(service.completeRequired('missing', 1, { finalText: 'Missing' })).rejects.toThrow('RUN_COMPLETION_CONFLICT');
      expect(listener).toHaveBeenCalledTimes(1);
      const active = await service.startRun({ sessionId: 's', turnId: 'active' });
      await service.checkpoint(active.id, { phase: 'llm_streaming' });
      await expect(service.completeRequired(active.id, 1, { finalText: 'Stale' })).rejects.toThrow('RUN_COMPLETION_CONFLICT');
      expect((await service.getTurn('s', 'active'))?.status).toBe('active');
    } finally { sqlite.close(); }
  });
  it.each(['queued', 'waiting_for_human', 'interrupted_needs_retry', 'interrupted', 'failed', 'cancelled', 'completed'] as const)('rejects nonactive %s even with current revision', async status => {
    const { service, sqlite } = makeFixture();
    try {
      const run = await service.startRun({ sessionId: 's', turnId: 't' });
      await service.checkpoint(run.id, { status });
      const before = await service.getTurn('s', 't');
      const listener = vi.fn();
      service.subscribeCompleted(listener);
      await expect(service.completeRequired(run.id, 2, { finalText: 'Must not write' })).rejects.toThrow('RUN_COMPLETION_CONFLICT');
      expect(await service.getTurn('s', 't')).toEqual(before);
      expect(listener).not.toHaveBeenCalled();
    } finally { sqlite.close(); }
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid revision %s before writing', async revision => {
    const { service, sqlite } = makeFixture();
    try {
      const run = await service.startRun({ sessionId: 's', turnId: 't' });
      await expect(service.completeRequired(run.id, revision, { finalText: '' })).rejects.toThrow('RUN_COMPLETION_INVALID');
      expect((await service.getTurn('s', 't'))?.revision).toBe(1);
    } finally { sqlite.close(); }
  });
  it.each([undefined, null, [], {}, { finalText: 1 }, { finalText: 'text', messageId: '' }, { finalText: 'text', extra: true }])('rejects invalid outcome shape without raw disclosure (%j)', async outcome => {
    const { service, sqlite } = makeFixture();
    try {
      const run = await service.startRun({ sessionId: 's', turnId: 't' });
      // Exercise runtime validation, not a caller-side typecast workaround.
      await expect(Reflect.apply(service.completeRequired, service, [run.id, 1, outcome])).rejects.toThrow('RUN_COMPLETION_INVALID');
      expect((await service.getTurn('s', 't'))?.revision).toBe(1);
    } finally { sqlite.close(); }
  });
  it('rolls back SQLite write failure and exposes no raw driver detail', async () => {
    const { service, sqlite } = makeFixture();
    try {
      const run = await service.startRun({ sessionId: 's', turnId: 't' });
      const before = await service.getTurn('s', 't');
      const listener = vi.fn();
      service.subscribeCompleted(listener);
      sqlite.exec("CREATE TRIGGER reject_completion AFTER UPDATE ON chat_runs BEGIN SELECT RAISE(ABORT, 'private secret outcome'); END;");
      await expect(service.completeRequired(run.id, 1, { finalText: 'secret content' })).rejects.toThrow('RUN_COMPLETION_STORAGE_ERROR');
      expect(await service.getTurn('s', 't')).toEqual(before);
      expect(listener).not.toHaveBeenCalled();
    } finally { sqlite.close(); }
  });
  it('rolls back if the read after update fails inside the transaction', async () => {
    const { service, sqlite } = makeFixture();
    try {
      const run = await service.startRun({ sessionId: 's', turnId: 't' });
      const before = await service.getTurn('s', 't');
      const listener = vi.fn();
      service.subscribeCompleted(listener);
      const originalPrepare = sqlite.prepare.bind(sqlite);
      const select = vi.spyOn(sqlite, 'prepare').mockImplementation(statement => {
        if (statement.startsWith('select')) throw new Error('private read parameters');
        return originalPrepare(statement);
      });
      await expect(service.completeRequired(run.id, 1, { finalText: 'secret' })).rejects.toThrow('RUN_COMPLETION_STORAGE_ERROR');
      select.mockRestore();
      expect(await service.getTurn('s', 't')).toEqual(before);
      expect(listener).not.toHaveBeenCalled();
    } finally { sqlite.close(); }
  });
  it('returns no receipt or notification when SQLite COMMIT itself fails', async () => {
    const { service, sqlite } = makeFixture();
    try {
      const run = await service.startRun({ sessionId: 's', turnId: 't' });
      const before = await service.getTurn('s', 't');
      const listener = vi.fn();
      service.subscribeCompleted(listener);
      sqlite.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE ack_parent (id INTEGER PRIMARY KEY);
        CREATE TABLE ack_child (id INTEGER REFERENCES ack_parent(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER deferred_completion AFTER UPDATE ON chat_runs
          BEGIN INSERT INTO ack_child VALUES (999); END;
      `);
      await expect(service.completeRequired(run.id, 1, { finalText: 'private result' })).rejects.toThrow('RUN_COMPLETION_STORAGE_ERROR');
      expect(await service.getTurn('s', 't')).toEqual(before);
      expect(sqlite.prepare('SELECT count(*) AS count FROM ack_child').get()).toEqual({ count: 0 });
      expect(listener).not.toHaveBeenCalled();
      expect(sqlite.inTransaction).toBe(false);
    } finally { sqlite.close(); }
  });
  it('keeps listeners non-awaited and isolates their mutations from the receipt', async () => {
    const { service, sqlite } = makeFixture();
    try {
      const run = await service.startRun({ sessionId: 's', turnId: 't' });
      let release!: () => void;
      service.subscribeCompleted(snapshot => {
        snapshot.status = 'failed';
        return new Promise<void>(resolve => { release = resolve; });
      });
      const receipt = await service.completeRequired(run.id, 1, { finalText: '' });
      expect(receipt.status).toBe('completed');
      release();
      expect((await service.getTurn('s', 't'))?.status).toBe('completed');
    } finally { sqlite.close(); }
  });
  it('rejects unserializable outcomes without leaking their content', async () => {
    const { service, sqlite } = makeFixture();
    try {
      const run = await service.startRun({ sessionId: 's', turnId: 't' });
      const cyclic: Record<string, unknown> = { private: 'secret' };
      cyclic['self'] = cyclic;
      await expect(service.completeRequired(run.id, 1, { finalText: 'private', structuredOutput: cyclic })).rejects.toThrow('RUN_COMPLETION_INVALID');
      expect((await service.getTurn('s', 't'))?.revision).toBe(1);
    } finally { sqlite.close(); }
  });
});

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
