import { Injectable, Logger, Optional } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { ChatRunSnapshot, SocketEvents } from '@kalio/types';
import { ChatService } from './chat.service';
import type { EmitFn } from './interfaces/stream-context.interface';
import { PerKeyMutex } from './per-key-mutex';
import { RunJournalService } from './run-journal.service';
import { ActiveSessionRegistry } from './active-session-registry.service';
import {
  claimQueuedDispatchItem,
  persistQueuedChatRun,
  queuedRunPosition,
  type DispatchItem,
  type QueuedItem,
} from './session-pipeline-queue.utils';

type ChatSendPayload = SocketEvents['chat:send'];

const QUEUE_CAP = 10;

interface ActiveSlot {
  donePromise: Promise<void>;
  resolveDone: () => void;
  seeded?: boolean;
  turnId: string;
  startedAt: number;
}

export interface SessionRuntimeStatus {
  sessionId: string;
  active: boolean;
  turnId?: string;
  queueLength: number;
  run?: ChatRunSnapshot;
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

  constructor(
    private readonly chat: ChatService,
    @Optional() private readonly runJournal?: RunJournalService,
    @Optional() private readonly activeSessionRegistry?: ActiveSessionRegistry,
  ) {}

  private setActive(sessionId: string, slot: ActiveSlot): void {
    this.active.set(sessionId, slot);
    this.activeSessionRegistry?.markActive(sessionId);
  }

  private deleteActive(sessionId: string): void {
    this.active.delete(sessionId);
    this.activeSessionRegistry?.markInactive(sessionId);
  }

  private createActiveSlot(turnId: string, options?: { seeded?: boolean }): ActiveSlot {
    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    return {
      donePromise,
      resolveDone,
      ...(options?.seeded ? { seeded: true } : {}),
      turnId,
      startedAt: Date.now(),
    };
  }

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
      | { kind: 'dispatch'; turnId: string }
      | { kind: 'queued' }
      | { kind: 'rejected' }
      | { kind: 'interrupt'; prior: Promise<void>; turnId: string }
    >(sid, async () => {
      if (isInterrupt && this.active.has(sid)) {
        this.chat.abort(sid);
        const slot = this.active.get(sid);
        return { kind: 'interrupt', prior: slot?.donePromise ?? Promise.resolve(), turnId: nanoid() };
      }
      if (this.active.has(sid)) {
        const queue = this.queues.get(sid) ?? [];
        if (payload.clientMessageId && this.runJournal) {
          const existingRun = await this.runJournal.findRunByQueueKey(sid, payload.clientMessageId);
          if (existingRun) {
            emit('chat:queued', {
              sessionId: sid,
              queueLength: queue.length,
              position: queuedRunPosition(queue, existingRun.id),
            });
            return { kind: 'queued' };
          }
        }
        if (queue.length >= QUEUE_CAP) {
          emit('chat:error', {
            sessionId: sid,
            code: 'QUEUE_FULL',
            message: `Queue is full (max ${QUEUE_CAP} pending messages per session)`,
            hadContent: false,
          });
          return { kind: 'rejected' };
        }
        const turnId = nanoid();
        let queuedItem: QueuedItem;
        if (this.runJournal) {
          const persistence = await persistQueuedChatRun({
            runJournal: this.runJournal,
            sessionId: sid,
            turnId,
            payload,
            emit,
          });
          if (persistence.kind === 'duplicate') {
            emit('chat:queued', {
              sessionId: sid,
              queueLength: queue.length,
              position: queuedRunPosition(queue, persistence.runId),
            });
            return { kind: 'queued' };
          }
          if (persistence.kind === 'rejected') {
            this.logger.error(`Unable to persist queued chat run for session ${sid}: ${persistence.message}`);
            emit('chat:error', {
              sessionId: sid,
              code: 'RUNTIME_PERSISTENCE_FAILED',
              message: 'Unable to persist runtime state. The queued turn was not accepted.',
              hadContent: false,
            });
            return { kind: 'rejected' };
          }
          queuedItem = persistence.item;
        } else {
          queuedItem = {
            emit,
            turnId,
            payload,
          };
        }
        queue.push(queuedItem);
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
      const turnId = nanoid();
      this.setActive(sid, this.createActiveSlot(turnId));
      return { kind: 'dispatch', turnId };
    });

    if (decision.kind === 'queued' || decision.kind === 'rejected') return;

    if (decision.kind === 'interrupt') {
      try {
        await decision.prior;
      } catch (err) {
        this.logger.warn(
          `Prior interrupted turn rejected for session ${payload.sessionId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (payload.content.trim().length === 0) return;
      // Re-claim the slot atomically before dispatching the interrupting
      // payload (the prior turn just released it).
      await this.mutex.runExclusive(sid, async () => {
        this.setActive(sid, this.createActiveSlot(decision.turnId));
      });
    }

    await this.runWithDrain({
      payload,
      emit,
      turnId: decision.turnId,
    });
  }

  async resumeQueuedSession(sessionId: string, emit: EmitFn): Promise<void> {
    if (!this.runJournal) return;

    const first = await this.mutex.runExclusive<QueuedItem | null>(sessionId, async () => {
      if (this.active.has(sessionId)) return null;
      const durableQueue = await this.runJournal!.listQueuedRuns(sessionId);
      if (durableQueue.length === 0) return null;

      const items = durableQueue.map((run): QueuedItem => ({
        emit,
        turnId: run.turnId,
        runId: run.id,
      }));
      const head = items.shift()!;
      if (items.length > 0) this.queues.set(sessionId, items);
      this.setActive(sessionId, this.createActiveSlot(head.turnId));
      return head;
    });

    if (!first) return;
    const dispatch = await this.toDispatchItem(sessionId, first);
    if (!dispatch) {
      await this.mutex.runExclusive(sessionId, async () => {
        this.deleteActive(sessionId);
      });
      return;
    }
    void this.runWithDrain(dispatch);
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
        this.deleteActive(sessionId);
      }
      // Drop queued items too — user explicitly stopped this session
      await this.dropQueuedItems(sessionId);
    });
  }

  /**
   * Abort the active turn, drop queued items, and wait for the current turn to
   * settle before releasing the slot. Used before destructive lifecycle
   * actions like session deletion so message persistence cannot race the row
   * removal.
   */
  async stopAndDrain(sessionId: string): Promise<void> {
    const activeSlot = await this.mutex.runExclusive<ActiveSlot | null>(sessionId, async () => {
      const slot = this.active.get(sessionId) ?? null;
      if (slot) {
        this.chat.abort(sessionId);
      }
      await this.dropQueuedItems(sessionId);
      return slot;
    });

    if (activeSlot && !activeSlot.seeded) {
      try {
        await activeSlot.donePromise;
      } catch (err) {
        this.logger.warn(
          `Draining aborted turn rejected for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    await this.mutex.runExclusive(sessionId, async () => {
      this.deleteActive(sessionId);
      await this.dropQueuedItems(sessionId);
    });
  }

  getActiveSessionIds(): ReadonlySet<string> {
    return new Set(this.active.keys());
  }

  getSessionStatus(sessionId: string): SessionRuntimeStatus {
    const slot = this.active.get(sessionId);
    const queueLength = this.queues.get(sessionId)?.length ?? 0;
    return {
      sessionId,
      active: Boolean(slot),
      ...(slot ? { turnId: slot.turnId } : {}),
      queueLength,
    };
  }

  async getSessionStatusWithRun(sessionId: string): Promise<SessionRuntimeStatus> {
    const status = this.getSessionStatus(sessionId);
    const run = await this.runJournal?.getCurrentRun(sessionId);
    return {
      ...status,
      ...(run ? { run } : {}),
    };
  }

  seedActiveTurn(sessionId: string, turnId: string): void {
    this.setActive(sessionId, this.createActiveSlot(turnId, { seeded: true }));
  }

  clearSeededActiveTurn(sessionId: string): void {
    this.deleteActive(sessionId);
    this.queues.delete(sessionId);
  }

  /**
   * Cancel the in-flight turn (if any) and drop any queued items for the
   * given session. Used on socket disconnect.
   */
  abortAll(sessionId: string): void {
    void this.mutex.runExclusive(sessionId, async () => {
      if (this.active.has(sessionId)) {
        this.chat.abort(sessionId);
      }
      await this.dropQueuedItems(sessionId);
    });
  }

  private async dropQueuedItems(sessionId: string): Promise<void> {
    const queue = this.queues.get(sessionId);
    if (!queue || queue.length === 0) {
      this.queues.delete(sessionId);
      return;
    }

    this.queues.delete(sessionId);
    for (const item of queue) {
      if (item.runId) {
        try {
          await this.runJournal?.cancelQueuedRun(item.runId);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`Unable to cancel queued chat run ${item.runId} for session ${sessionId}: ${message}`);
        }
      }
      item.emit('chat:error', {
        sessionId,
        code: 'QUEUE_DROPPED',
        message: 'Queued turn was dropped because the session was stopped.',
        hadContent: false,
      });
    }
  }

  private async runWithDrain(initial: DispatchItem): Promise<void> {
    const sid = initial.payload.sessionId;
    let current: DispatchItem | null = initial;
    while (current) {
      await this.runOne(current);
      // Pop next queued item OR release active slot, atomically.
      // Without the mutex a concurrent submit could observe `active=false`
      // (briefly between iterations) and start a parallel drain.
      current = await this.mutex.runExclusive<DispatchItem | null>(sid, async () => {
        const queue = this.queues.get(sid);
        while (queue && queue.length > 0) {
          const next = queue.shift()!;
          if (queue.length === 0) {
            this.queues.delete(sid);
          }
          const dispatch = await this.toDispatchItem(sid, next);
          if (!dispatch) {
            continue;
          }
          // Keep `active` set so concurrent submits enqueue rather than dispatch.
          this.setActive(sid, this.createActiveSlot(dispatch.turnId));
          return dispatch;
        }
        this.queues.delete(sid);
        this.deleteActive(sid);
        return null;
      });
    }
  }

  private async toDispatchItem(sessionId: string, queued: QueuedItem): Promise<DispatchItem | null> {
    return claimQueuedDispatchItem({
      sessionId,
      queued,
      runJournal: this.runJournal,
      onError: (message) => this.logger.error(message),
    });
  }

  private async runOne(current: DispatchItem): Promise<void> {
    const sid = current.payload.sessionId;
    const slot = this.active.get(sid) ?? this.createActiveSlot(current.turnId);
    try {
      let run: ChatRunSnapshot | undefined;
      try {
        run = current.runId
          ? {
            id: current.runId,
            sessionId: sid,
            turnId: current.turnId,
            phase: 'started',
            status: 'active',
            retryCount: 0,
            safeResume: false,
            startedAt: 0,
            updatedAt: 0,
            lastHeartbeatAt: 0,
          }
          : await this.runJournal?.startRun({
            sessionId: sid,
            turnId: current.turnId,
          });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Unable to start durable chat run for session ${sid}: ${message}`);
        current.emit('chat:error', {
          sessionId: sid,
          code: 'RUNTIME_PERSISTENCE_FAILED',
          message: 'Unable to persist runtime state. The turn was not started.',
          hadContent: false,
        });
        return;
      }

      const executionPromise = this.chat
        .handleTurn(
          sid,
          current.payload.content,
          current.payload.personaId,
          current.emit,
          current.payload.attachments,
          current.turnId,
          run?.id,
          current.payload.clientMessageId,
        )
        .catch((err) => {
          // ChatService.handleTurn already swallows its own errors, but be
          // defensive so a thrown error never wedges the pipeline state.
          this.logger.error(
            `handleTurn rejected for session ${sid}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      await executionPromise;
    } finally {
      slot.resolveDone();
    }
  }
}
