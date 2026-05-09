import { Injectable, Logger } from '@nestjs/common';
import type { SocketEvents } from '@kalio/types';
import { ChatService } from './chat.service';
import type { EmitFn } from './interfaces/stream-context.interface';
import { PerKeyMutex } from './per-key-mutex';

type ChatSendPayload = SocketEvents['chat:send'];

const QUEUE_CAP = 10;

interface ActiveSlot {
  donePromise: Promise<void>;
}

interface QueuedItem {
  payload: ChatSendPayload;
  emit: EmitFn;
}

/**
 * Per-session FSM that sits between the gateway and ChatService.
 *
 * Responsibilities:
 *  - Serialise turns within a single session (no overlapping
 *    `agent:start`/`agent:done` brackets).
 *  - Enqueue follow-up `chat:send` payloads that arrive while a turn is
 *    in-flight; drain the queue head-first after each `agent:done`.
 *  - Honour `interrupt: true` by aborting the current turn (at the next
 *    iteration boundary) and dispatching the interrupting payload itself
 *    once the abort settles.
 *  - Provide `abortAll(sessionId)` for disconnect cleanup.
 *
 * Different sessions are independent — running session A does NOT block
 * session B.
 */
@Injectable()
export class SessionPipelineService {
  private readonly logger = new Logger(SessionPipelineService.name);
  private readonly active = new Map<string, ActiveSlot>();
  private readonly queues = new Map<string, QueuedItem[]>();
  private readonly mutex = new PerKeyMutex();

  constructor(private readonly chat: ChatService) {}

  async submit(payload: ChatSendPayload, emit: EmitFn): Promise<void> {
    const sid = payload.sessionId;
    const isInterrupt = payload.interrupt === true;

    // Decide+claim atomically per-session. The decision phase mutates
    // `active` and `queues`; without the mutex two concurrent submits for
    // an idle session could both pass the `isActive` check and both call
    // `runWithDrain`, double-booking the session.
    //
    // Returns one of:
    //   { kind: 'dispatch' }  → run the payload now (we own the slot)
    //   { kind: 'queued' }    → enqueued; nothing else to do
    //   { kind: 'rejected' }  → queue full / no-op interrupt
    //   { kind: 'wait', wait: Promise } → interrupt fired, must drain
    //                                      the prior turn before dispatching
    const decision = await this.mutex.runExclusive<
      | { kind: 'dispatch' }
      | { kind: 'queued' }
      | { kind: 'rejected' }
      | { kind: 'interrupt'; prior: Promise<void> }
    >(sid, async () => {
      if (isInterrupt && this.active.has(sid)) {
        this.chat.abort(sid);
        const slot = this.active.get(sid);
        return { kind: 'interrupt', prior: slot?.donePromise ?? Promise.resolve() };
      }
      if (this.active.has(sid)) {
        const queue = this.queues.get(sid) ?? [];
        if (queue.length >= QUEUE_CAP) {
          emit('chat:error', {
            sessionId: sid,
            code: 'QUEUE_FULL',
            message: `Queue is full (max ${QUEUE_CAP} pending messages per session)`,
            hadContent: false,
          });
          return { kind: 'rejected' };
        }
        queue.push({ payload, emit });
        this.queues.set(sid, queue);
        emit('chat:queued', {
          sessionId: sid,
          queueLength: queue.length,
          position: queue.length,
        });
        return { kind: 'queued' };
      }
      // Idle session: claim the active slot before releasing the lock so
      // any concurrent submit will see us as active.
      this.active.set(sid, { donePromise: Promise.resolve() });
      return { kind: 'dispatch' };
    });

    if (decision.kind === 'queued' || decision.kind === 'rejected') return;

    if (decision.kind === 'interrupt') {
      try {
        await decision.prior;
      } catch {
        // handleTurn doesn't throw, but be defensive
      }
      if (payload.content.trim().length === 0) return;
      // Re-claim the slot atomically before dispatching the interrupting
      // payload (the prior turn just released it).
      await this.mutex.runExclusive(sid, async () => {
        this.active.set(sid, { donePromise: Promise.resolve() });
      });
    }

    await this.runWithDrain(payload, emit);
  }

  /**
   * Abort the active turn (if any) for a session without dispatching a new one.
   * Used by the explicit chat:stop socket event.
   *
   * Must run inside the mutex so it is serialised after any in-flight
   * submit() mutex callbacks that may not yet have added their item to the
   * queue. Without this, a submit() whose microtask hasn't run yet would
   * still enqueue itself after queues.delete() returns, and runWithDrain
   * would dispatch it despite the explicit stop.
   *
   * Deleting from `active` prevents a subsequent submit() (e.g. user
   * pressing Send immediately after Stop) from being treated as queued
   * rather than as a fresh dispatch.
   */
  stop(sessionId: string): void {
    void this.mutex.runExclusive(sessionId, async () => {
      if (this.active.has(sessionId)) {
        this.chat.abort(sessionId);
        this.active.delete(sessionId);
      }
      // Drop queued items too — user explicitly stopped this session
      this.queues.delete(sessionId);
    });
  }

  /**
   * Cancel the in-flight turn (if any) and drop any queued items for the
   * given session. Used on socket disconnect.
   */
  abortAll(sessionId: string): void {
    if (this.active.has(sessionId)) {
      this.chat.abort(sessionId);
    }
    this.queues.delete(sessionId);
  }

  private async runWithDrain(payload: ChatSendPayload, emit: EmitFn): Promise<void> {
    const sid = payload.sessionId;
    let current: { payload: ChatSendPayload; emit: EmitFn } | null = { payload, emit };
    while (current) {
      await this.runOne(current.payload, current.emit);
      // Pop next queued item OR release active slot, atomically.
      // Without the mutex a concurrent submit could observe `active=false`
      // (briefly between iterations) and start a parallel drain.
      current = await this.mutex.runExclusive<
        { payload: ChatSendPayload; emit: EmitFn } | null
      >(sid, async () => {
        const queue = this.queues.get(sid);
        if (!queue || queue.length === 0) {
          this.queues.delete(sid);
          this.active.delete(sid);
          return null;
        }
        const next = queue.shift()!;
        // Keep `active` set so concurrent submits enqueue rather than dispatch.
        return next;
      });
    }
  }

  private async runOne(payload: ChatSendPayload, emit: EmitFn): Promise<void> {
    const sid = payload.sessionId;
    const donePromise = this.chat
      .handleTurn(sid, payload.content, payload.personaId, emit, payload.attachments)
      .catch((err) => {
        // ChatService.handleTurn already swallows its own errors, but be
        // defensive so a thrown error never wedges the pipeline state.
        this.logger.error(
          `handleTurn rejected for session ${sid}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    // Update donePromise so an interrupt waiter can observe completion.
    this.active.set(sid, { donePromise });
    await donePromise;
  }
}
