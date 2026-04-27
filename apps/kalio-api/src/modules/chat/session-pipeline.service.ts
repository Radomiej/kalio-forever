import { Injectable, Logger } from '@nestjs/common';
import type { SocketEvents } from '@kalio/types';
import { ChatService } from './chat.service';
import type { EmitFn } from './interfaces/stream-context.interface';

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

  constructor(private readonly chat: ChatService) {}

  async submit(payload: ChatSendPayload, emit: EmitFn): Promise<void> {
    const sid = payload.sessionId;
    const isActive = this.active.has(sid);
    const isInterrupt = payload.interrupt === true;

    if (isInterrupt && isActive) {
      // Abort current; wait for the in-flight turn to finish unwinding
      // (handleTurn always emits agent:done before resolving).
      this.chat.abort(sid);
      const slot = this.active.get(sid);
      try {
        await slot?.donePromise;
      } catch {
        // handleTurn doesn't throw, but be defensive
      }
      // Empty content = pure Stop, no new turn
      if (payload.content.trim().length === 0) return;
      // Fall through to immediate dispatch of the interrupting payload
    } else if (isActive) {
      const queue = this.queues.get(sid) ?? [];
      if (queue.length >= QUEUE_CAP) {
        emit('chat:error', {
          sessionId: sid,
          code: 'QUEUE_FULL',
          message: `Queue is full (max ${QUEUE_CAP} pending messages per session)`,
        });
        return;
      }
      queue.push({ payload, emit });
      this.queues.set(sid, queue);
      emit('chat:queued', {
        sessionId: sid,
        queueLength: queue.length,
        position: queue.length,
      });
      return;
    }

    await this.runWithDrain(payload, emit);
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
    await this.runOne(payload, emit);
    // Drain any queued follow-ups for the same session in FIFO order.
    while (true) {
      const queue = this.queues.get(payload.sessionId);
      if (!queue || queue.length === 0) {
        this.queues.delete(payload.sessionId);
        return;
      }
      const next = queue.shift()!;
      this.queues.set(payload.sessionId, queue);
      await this.runOne(next.payload, next.emit);
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

    this.active.set(sid, { donePromise });
    try {
      await donePromise;
    } finally {
      this.active.delete(sid);
    }
  }
}
