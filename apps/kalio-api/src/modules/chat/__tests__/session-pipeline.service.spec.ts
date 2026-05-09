import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionPipelineService } from '../session-pipeline.service';
import type { ChatService } from '../chat.service';
import type { SocketEvents } from '@kalio/types';
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

describe('SessionPipelineService', () => {
  let svc: SessionPipelineService;
  let chatHarness: ReturnType<typeof makeBlockingChatService>;

  beforeEach(() => {
    chatHarness = makeBlockingChatService();
    svc = new SessionPipelineService(chatHarness.chat as ChatService);
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
    svc.submit(basePayload('s1', 'b'), emit);
    svc.submit(basePayload('s1', 'c'), emit);
    await flush();

    svc.abortAll('s1');
    await chatHarness.releaseAll();
    // give microtasks a moment
    await new Promise((r) => setTimeout(r, 5));

    // After purge, the queued b/c never reach handleTurn
    expect(chatHarness.callsReceived.map((c) => c.content)).toEqual(['a']);
  });

  it('abortAll on idle session (no active turn) is a no-op and does not throw', () => {
    expect(() => svc.abortAll('never-used-session')).not.toThrow();
  });
});
