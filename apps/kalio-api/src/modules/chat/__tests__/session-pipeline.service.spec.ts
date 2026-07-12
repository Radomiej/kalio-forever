import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionPipelineService } from '../session-pipeline.service';
import type { ChatService } from '../chat.service';
import type { RunJournalService } from '../run-journal.service';
import type { ChatQueuedPayload, ChatRunSnapshot, SocketEvents } from '@kalio/types';
import type { EmitFn } from '../interfaces/stream-context.interface';

type ChatSendPayload = SocketEvents['chat:send'];

/**
 * Build a fake ChatService whose handleTurn() blocks on a manually-resolved
 * promise so we can deterministically test queueing/interrupt semantics.
 */
function makeBlockingChatService(): {
  chat: Pick<ChatService, 'handleTurn' | 'abort'>;
  release: (sessionId: string) => void;
  releaseAll: () => void;
  callsReceived: ChatSendPayload[];
  emitsPerCall: EmitFn[];
} {
  const callsReceived: ChatSendPayload[] = [];
  const emitsPerCall: EmitFn[] = [];
  const releasers = new Map<string, () => void>();
  const releaseQueue: Array<() => void> = [];

  const handleTurn = vi.fn().mockImplementation(
    async (sessionId: string, content: string, personaId: string, emit: EmitFn): Promise<void> => {
      callsReceived.push({ sessionId, content, personaId });
      emitsPerCall.push(emit);
      // Emit start/done so the pipeline can observe lifecycle in event order
      emit('agent:start', { sessionId, turnId: `turn-${callsReceived.length}` });
      await new Promise<void>((resolve) => {
        releaseQueue.push(resolve);
        releasers.set(sessionId, resolve);
      });
      emit('chat:complete', { sessionId, messageId: `msg-${callsReceived.length}` });
      emit('agent:done', { sessionId, turnId: `turn-${callsReceived.length}` });
    },
  );

  const abort = vi.fn();

  return {
    chat: { handleTurn, abort } as unknown as Pick<ChatService, 'handleTurn' | 'abort'>,
    release: (sid: string) => {
      const fn = releasers.get(sid);
      if (fn) {
        releasers.delete(sid);
        fn();
      } else {
        // fall back to FIFO order if exact session not pinned
        const next = releaseQueue.shift();
        next?.();
      }
    },
    releaseAll: async () => {
      // Each release lets the next queued/interrupting turn start, which
      // pushes its own releaser on the next microtask. Loop until quiescent.
      while (releaseQueue.length > 0) {
        const fn = releaseQueue.shift()!;
        fn();
        // Let the awaited promise chain run so the next handleTurn can register
        await new Promise((r) => setImmediate(r));
      }
      releasers.clear();
    },
    callsReceived,
    emitsPerCall,
  };
}

/** Drain all pending microtasks/macrotasks so the mutex chain can settle. */
const flush = () => new Promise<void>((r) => setImmediate(r));

function makeEmit(): { emit: EmitFn; events: Array<{ event: string; data: unknown }> } {
  const events: Array<{ event: string; data: unknown }> = [];
  const emit: EmitFn = (event, data) => {
    events.push({ event: event as string, data });
  };
  return { emit, events };
}

const basePayload = (sid: string, content: string, interrupt = false): ChatSendPayload => ({
  sessionId: sid,
  content,
  personaId: 'p1',
  ...(interrupt ? { interrupt: true } : {}),
});

function makeRunSnapshot(params: {
  id: string;
  sessionId: string;
  turnId: string;
  phase: ChatRunSnapshot['phase'];
  status: ChatRunSnapshot['status'];
  queuedPayload?: ChatQueuedPayload;
  queueIdempotencyKey?: string;
  queuedAt?: number;
  queueClaimedAt?: number;
  queueCancelledAt?: number;
  revision?: number;
}): ChatRunSnapshot {
  return {
    id: params.id,
    sessionId: params.sessionId,
    turnId: params.turnId,
    phase: params.phase,
    status: params.status,
    revision: params.revision ?? 1,
    retryCount: 0,
    safeResume: false,
    ...(params.queuedPayload ? { queuedPayload: params.queuedPayload } : {}),
    ...(params.queueIdempotencyKey ? { queueIdempotencyKey: params.queueIdempotencyKey } : {}),
    ...(params.queuedAt !== undefined ? { queuedAt: params.queuedAt } : {}),
    ...(params.queueClaimedAt !== undefined ? { queueClaimedAt: params.queueClaimedAt } : {}),
    ...(params.queueCancelledAt !== undefined ? { queueCancelledAt: params.queueCancelledAt } : {}),
    startedAt: 0,
    updatedAt: 0,
    lastHeartbeatAt: 0,
  };
}

describe('SessionPipelineService', () => {
  let svc: SessionPipelineService;
  let chatHarness: ReturnType<typeof makeBlockingChatService>;
  let runJournal: {
    startRun: ReturnType<typeof vi.fn>;
    acceptQueuedRun: ReturnType<typeof vi.fn>;
    claimQueuedRun: ReturnType<typeof vi.fn>;
    listQueuedRuns: ReturnType<typeof vi.fn>;
    cancelQueuedRun: ReturnType<typeof vi.fn>;
    checkpoint: ReturnType<typeof vi.fn>;
    getCurrentRun: ReturnType<typeof vi.fn>;
  };
  let queuedRuns: ChatRunSnapshot[];
  let queuedRunsByKey: Map<string, ChatRunSnapshot>;

  beforeEach(() => {
    chatHarness = makeBlockingChatService();
    queuedRuns = [];
    queuedRunsByKey = new Map();
    runJournal = {
      startRun: vi.fn().mockImplementation(async ({ sessionId, turnId }: { sessionId: string; turnId: string }) => (
        makeRunSnapshot({
          id: `run-${turnId}`,
          sessionId,
          turnId,
          phase: 'started',
          status: 'active',
        })
      )),
      acceptQueuedRun: vi.fn().mockImplementation(async ({
        sessionId,
        turnId,
        queueIdempotencyKey,
        queuedPayload,
      }: {
        sessionId: string;
        turnId: string;
        queueIdempotencyKey: string;
        queuedPayload: ChatQueuedPayload;
      }) => {
        const existing = queuedRunsByKey.get(`${sessionId}:${queueIdempotencyKey}`);
        if (existing) {
          return existing;
        }
        const run = makeRunSnapshot({
          id: `run-${turnId}`,
          sessionId,
          turnId,
          phase: 'queued',
          status: 'queued',
          queueIdempotencyKey,
          queuedPayload,
          queuedAt: queuedRuns.length + 1,
        });
        queuedRuns.push(run);
        queuedRunsByKey.set(`${sessionId}:${queueIdempotencyKey}`, run);
        return run;
      }),
      claimQueuedRun: vi.fn().mockImplementation(async (sessionId: string, runId?: string) => {
        const idx = queuedRuns.findIndex((run) => (
          run.sessionId === sessionId && run.status === 'queued' && (!runId || run.id === runId)
        ));
        if (idx < 0) {
          return null;
        }
        const current = queuedRuns[idx]!;
        const claimed = makeRunSnapshot({
          ...current,
          phase: 'started',
          status: 'active',
          revision: (current.revision ?? 1) + 1,
          queueClaimedAt: (current.queueClaimedAt ?? 0) + 1,
        });
        queuedRuns[idx] = claimed;
        return claimed;
      }),
      listQueuedRuns: vi.fn().mockImplementation(async (sessionId: string) => (
        queuedRuns.filter((run) => run.sessionId === sessionId && run.status === 'queued')
      )),
      cancelQueuedRun: vi.fn().mockImplementation(async (runId: string) => {
        const idx = queuedRuns.findIndex((run) => run.id === runId);
        if (idx < 0) {
          return false;
        }
        const current = queuedRuns[idx]!;
        queuedRuns[idx] = makeRunSnapshot({
          ...current,
          status: 'cancelled',
          queueCancelledAt: (current.queueCancelledAt ?? 0) + 1,
          revision: (current.revision ?? 1) + 1,
        });
        return true;
      }),
      checkpoint: vi.fn().mockResolvedValue(undefined),
      getCurrentRun: vi.fn().mockResolvedValue(null),
    };
    svc = new SessionPipelineService(
      chatHarness.chat as ChatService,
      runJournal as unknown as RunJournalService,
    );
  });

  it('recovers durable queued work with the accepted identity after process restart', async () => {
    const recovered = makeRunSnapshot({
      id: 'run-recovered',
      sessionId: 's1',
      turnId: 'turn-recovered',
      phase: 'queued',
      status: 'queued',
      queuedPayload: { content: 'recover me', personaId: 'p1', clientMessageId: 'message-recovered' },
    });
    queuedRuns.push(recovered);
    const { emit } = makeEmit();

    await svc.resumeQueuedSession('s1', emit);
    await flush();

    expect(runJournal.claimQueuedRun).toHaveBeenCalledWith('s1', 'run-recovered');
    expect(chatHarness.chat.handleTurn).toHaveBeenCalledWith(
      's1',
      'recover me',
      'p1',
      emit,
      undefined,
      'turn-recovered',
      'run-recovered',
      'message-recovered',
    );
    chatHarness.release('s1');
    await flush();
  });

  it('releases the active slot when durable run creation fails', async () => {
    runJournal.startRun.mockRejectedValueOnce(new Error('journal unavailable'));
    const { emit, events } = makeEmit();

    await expect(svc.submit(basePayload('s1', 'hello'), emit)).resolves.toBeUndefined();

    expect(svc.getSessionStatus('s1')).toMatchObject({ active: false, queueLength: 0 });
    expect(events).toContainEqual({
      event: 'chat:error',
      data: expect.objectContaining({ code: 'RUNTIME_PERSISTENCE_FAILED', sessionId: 's1' }),
    });
  });

  it('idle submit dispatches immediately', async () => {
    const { emit, events } = makeEmit();
    const promise = svc.submit(basePayload('s1', 'hello'), emit);
    await flush();
    expect(chatHarness.callsReceived).toHaveLength(1);
    expect(chatHarness.callsReceived[0].content).toBe('hello');
    // No chat:queued for an idle session
    expect(events.find((e) => e.event === 'chat:queued')).toBeUndefined();
    chatHarness.release('s1');
    await promise;
  });

  it('submit during active turn enqueues and emits chat:queued', async () => {
    const { emit, events } = makeEmit();
    const first = svc.submit(basePayload('s1', 'first'), emit);
    await flush();
    expect(chatHarness.callsReceived).toHaveLength(1);

    const second = svc.submit(basePayload('s1', 'second'), emit);
    await flush();

    // Still only one handleTurn call
    expect(chatHarness.callsReceived).toHaveLength(1);
    const queued = events.find((e) => e.event === 'chat:queued');
    expect(queued).toBeDefined();
    expect(queued!.data).toMatchObject({ sessionId: 's1', queueLength: 1, position: 1 });

    await chatHarness.releaseAll();
    await first;
    await second;
    expect(chatHarness.callsReceived.map((c) => c.content)).toEqual(['first', 'second']);
  });

  it('drains queue head after agent:done in FIFO order', async () => {
    const { emit } = makeEmit();
    const p1 = svc.submit(basePayload('s1', 'a'), emit);
    await flush();
    const p2 = svc.submit(basePayload('s1', 'b'), emit);
    const p3 = svc.submit(basePayload('s1', 'c'), emit);
    await flush();

    expect(chatHarness.callsReceived).toHaveLength(1);
    await chatHarness.releaseAll();
    await Promise.all([p1, p2, p3]);

    expect(chatHarness.callsReceived.map((c) => c.content)).toEqual(['a', 'b', 'c']);
  });

  it('interrupt aborts current turn and starts new one with the interrupting payload', async () => {
    const { emit } = makeEmit();
    const p1 = svc.submit(basePayload('s1', 'first'), emit);
    await flush();
    expect(chatHarness.callsReceived).toHaveLength(1);

    const p2 = svc.submit(basePayload('s1', 'urgent', true), emit);
    // Interrupt should call abort on the chat service
    await flush();
    expect(chatHarness.chat.abort).toHaveBeenCalledWith('s1');

    await chatHarness.releaseAll(); // unblock both runs
    await p1;
    await p2;

    expect(chatHarness.callsReceived.map((c) => c.content)).toEqual(['first', 'urgent']);
  });

  it('multiple sessions are isolated (one session running does not block another)', async () => {
    const { emit } = makeEmit();
    const a = svc.submit(basePayload('sA', 'msgA'), emit);
    const b = svc.submit(basePayload('sB', 'msgB'), emit);
    await flush();
    // Both should run concurrently
    expect(chatHarness.callsReceived).toHaveLength(2);
    await chatHarness.releaseAll();
    await Promise.all([a, b]);
  });

  it('queue cap of 10 enforces backpressure with chat:error QUEUE_FULL', async () => {
    const { emit, events } = makeEmit();
    const promises: Promise<void>[] = [];
    promises.push(svc.submit(basePayload('s1', 'active'), emit));
    await flush();
    // Fill queue to cap
    for (let i = 0; i < 10; i++) {
      promises.push(svc.submit(basePayload('s1', `q${i}`), emit));
      await flush();
    }
    // 11th queued submit should be rejected
    promises.push(svc.submit(basePayload('s1', 'overflow'), emit));
    await flush();

    const errors = events.filter((e) => e.event === 'chat:error');
    expect(errors.some((e) => (e.data as { code: string }).code === 'QUEUE_FULL')).toBe(true);

    await chatHarness.releaseAll();
    await Promise.all(promises);
  });

  it('empty interrupt acts as a pure Stop (aborts current, no new turn)', async () => {
    const { emit } = makeEmit();
    const p1 = svc.submit(basePayload('s1', 'first'), emit);
    await flush();
    const stop = svc.submit(basePayload('s1', '', true), emit);
    await flush();

    expect(chatHarness.chat.abort).toHaveBeenCalledWith('s1');
    await chatHarness.releaseAll();
    await p1;
    await stop;

    // Only the original turn should have been dispatched
    expect(chatHarness.callsReceived).toHaveLength(1);
    expect(chatHarness.callsReceived[0].content).toBe('first');
  });

  it('persists queue acceptance before projection and claims the same durable run before dequeue execution', async () => {
    const order: string[] = [];
    runJournal.acceptQueuedRun.mockImplementation(async ({
      sessionId,
      turnId,
      queueIdempotencyKey,
      queuedPayload,
    }: {
      sessionId: string;
      turnId: string;
      queueIdempotencyKey: string;
      queuedPayload: ChatQueuedPayload;
    }) => {
      order.push(`journal:${turnId}:accept`);
      const run = makeRunSnapshot({
        id: `run-${turnId}`,
        sessionId,
        turnId,
        phase: 'queued',
        status: 'queued',
        queueIdempotencyKey,
        queuedPayload,
        queuedAt: order.length,
      });
      queuedRuns.push(run);
      queuedRunsByKey.set(`${sessionId}:${queueIdempotencyKey}`, run);
      return run;
    });
    runJournal.claimQueuedRun.mockImplementation(async (sessionId: string) => {
      const next = queuedRuns.find((run) => run.sessionId === sessionId && run.status === 'queued');
      if (!next) return null;
      order.push(`journal:${next.id}:claim`);
      const claimed = makeRunSnapshot({
        ...next,
        phase: 'started',
        status: 'active',
        revision: (next.revision ?? 1) + 1,
        queueClaimedAt: order.length,
      });
      queuedRuns = queuedRuns.map((run) => (run.id === claimed.id ? claimed : run));
      return claimed;
    });
    vi.mocked(chatHarness.chat.handleTurn).mockImplementation(async (...args: unknown[]) => {
      const sessionId = args[0] as string;
      const content = args[1] as string;
      const emit = args[3] as EmitFn;
      const turnId = args[5] as string;
      const runId = args[6] as string;
      order.push(`handle:${content}:${turnId}:${runId}`);
      chatHarness.callsReceived.push({ sessionId, content, personaId: 'p1' });
      await new Promise<void>((resolve) => setImmediate(resolve));
      emit('agent:done', { sessionId, turnId });
    });
    const projected = makeEmit();
    const emit: EmitFn = (event, data) => {
      if (event === 'chat:queued') order.push('emit:queued');
      projected.emit(event, data);
    };

    const first = svc.submit(basePayload('s1', 'first'), emit);
    const second = svc.submit(basePayload('s1', 'second'), emit);
    await Promise.all([first, second]);

    const accepted = runJournal.acceptQueuedRun.mock.calls.map(([input]) => input as { turnId: string });
    expect(runJournal.startRun).toHaveBeenCalledTimes(1);
    expect(accepted).toHaveLength(1);
    const queuedTurnId = accepted[0]!.turnId;
    expect(order.indexOf(`journal:${queuedTurnId}:accept`)).toBeLessThan(order.indexOf('emit:queued'));
    expect(order.indexOf(`journal:run-${queuedTurnId}:claim`)).toBeLessThan(
      order.indexOf(`handle:second:${queuedTurnId}:run-${queuedTurnId}`),
    );
  });

  it('stop cancels durable queued work before emitting queue dropped', async () => {
    const { emit } = makeEmit();
    const first = svc.submit(basePayload('s1', 'first'), emit);
    await flush();
    const queued = makeEmit();
    await svc.submit(basePayload('s1', 'second'), queued.emit);
    await flush();

    const queuedTurnId = (runJournal.acceptQueuedRun.mock.calls[0]![0] as { turnId: string }).turnId;

    svc.stop('s1');
    await flush();

    expect(runJournal.cancelQueuedRun).toHaveBeenCalledWith(`run-${queuedTurnId}`);
    expect(queued.events).toContainEqual({
      event: 'chat:error',
      data: expect.objectContaining({
        sessionId: 's1',
        code: 'QUEUE_DROPPED',
        hadContent: false,
      }),
    });

    chatHarness.release('s1');
    await first;
    expect(chatHarness.callsReceived.map((c) => c.content)).toEqual(['first']);
  });

  it('stopAndDrain aborts the active turn, waits for completion, and drops queued work', async () => {
    const { emit } = makeEmit();
    const first = svc.submit(basePayload('s1', 'first'), emit);
    await flush();
    const queued = makeEmit();
    const second = svc.submit(basePayload('s1', 'second'), queued.emit);
    await flush();

    let drained = false;
    const stopPromise = svc.stopAndDrain('s1').then(() => {
      drained = true;
    });

    await flush();
    expect(chatHarness.chat.abort).toHaveBeenCalledWith('s1');
    expect(drained).toBe(false);

    chatHarness.release('s1');
    await stopPromise;
    await first;
    await second;

    expect(drained).toBe(true);
    expect(chatHarness.callsReceived.map((c) => c.content)).toEqual(['first']);
    expect(runJournal.cancelQueuedRun).toHaveBeenCalledTimes(1);
    expect(queued.events).toContainEqual({
      event: 'chat:error',
      data: expect.objectContaining({
        sessionId: 's1',
        code: 'QUEUE_DROPPED',
        hadContent: false,
      }),
    });
  });

  it('stopAndDrain clears seeded active turns without waiting indefinitely', async () => {
    svc.seedActiveTurn('seeded-session', 'seeded-turn');

    await expect(svc.stopAndDrain('seeded-session')).resolves.toBeUndefined();
    expect(svc.getSessionStatus('seeded-session').active).toBe(false);
  });

  it('serialises concurrent submits to an idle session (race condition guard)', async () => {
    // Fire 5 submits in the same microtask without any awaits between them.
    // Without per-session atomicity, several would observe `isActive=false`
    // and all call handleTurn → multiple agent:start brackets per session.
    const { emit, events } = makeEmit();
    const promises = [
      svc.submit(basePayload('s1', 'm0'), emit),
      svc.submit(basePayload('s1', 'm1'), emit),
      svc.submit(basePayload('s1', 'm2'), emit),
      svc.submit(basePayload('s1', 'm3'), emit),
      svc.submit(basePayload('s1', 'm4'), emit),
    ];
    // Let mutex chains settle their decision phase
    await new Promise((r) => setImmediate(r));

    // Exactly one handleTurn should be active; the rest must be queued.
    expect(chatHarness.callsReceived).toHaveLength(1);
    const queuedEvents = events.filter((e) => e.event === 'chat:queued');
    expect(queuedEvents).toHaveLength(4);

    await chatHarness.releaseAll();
    await Promise.all(promises);

    // All five should eventually run in submission order.
    expect(chatHarness.callsReceived.map((c) => c.content)).toEqual([
      'm0', 'm1', 'm2', 'm3', 'm4',
    ]);
  });

  it('disconnect/abortAll purges queue and active for a session', async () => {
    const { emit } = makeEmit();
    svc.submit(basePayload('s1', 'a'), emit);
    await flush();
    const queuedB = makeEmit();
    const queuedC = makeEmit();
    svc.submit(basePayload('s1', 'b'), queuedB.emit);
    svc.submit(basePayload('s1', 'c'), queuedC.emit);
    await flush();

    svc.abortAll('s1');
    await chatHarness.releaseAll();
    await flush();

    // After purge, the queued b/c never reach handleTurn
    expect(chatHarness.callsReceived.map((c) => c.content)).toEqual(['a']);
    expect(runJournal.cancelQueuedRun).toHaveBeenCalledTimes(2);
    for (const queued of [queuedB, queuedC]) {
      expect(queued.events).toContainEqual({
        event: 'chat:error',
        data: expect.objectContaining({
          sessionId: 's1',
          code: 'QUEUE_DROPPED',
          hadContent: false,
        }),
      });
    }
  });

  it('abortAll on idle session (no active turn) is a no-op and does not throw', () => {
    expect(() => svc.abortAll('never-used-session')).not.toThrow();
  });
});
