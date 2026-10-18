import { Injectable, Logger, Optional } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { ChatRunSnapshot, SocketEvents } from '@kalio/types';
import { ChatService } from './chat.service';
import type { EmitFn } from './interfaces/stream-context.interface';
import { PerKeyMutex } from './per-key-mutex';
import { RunJournalService } from './run-journal.service';
import { ActiveSessionRegistry } from './active-session-registry.service';
import { SessionExecutionAdmission, type SessionExecutionReservation, type SessionStopLease } from './session-execution-admission';
import {
  claimQueuedDispatchItem,
  persistQueuedChatRun,
  queuedRunPosition,
  type DispatchItem,
  type QueuedItem,
} from './session-pipeline-queue.utils';

type ChatSendPayload = SocketEvents['chat:send'];

const QUEUE_CAP = 10;

export interface SessionRuntimeStatus {
  sessionId: string;
  active: boolean;
  turnId?: string;
  queueLength: number;
  run?: ChatRunSnapshot;
}

/** Serializes session turns and retains admission fences while Stop drains. */
@Injectable()
export class SessionPipelineService {
  private readonly logger = new Logger(SessionPipelineService.name);
  private readonly active = new SessionExecutionAdmission();
  private readonly queues = new Map<string, QueuedItem[]>();
  private readonly mutex = new PerKeyMutex();

  constructor(
    private readonly chat: ChatService,
    @Optional() private readonly runJournal?: RunJournalService,
    @Optional() private readonly activeSessionRegistry?: ActiveSessionRegistry,
  ) {
    this.chat.setContinuationAdmission?.({
      capture: () => this.active.capture(),
      abort: (sessionId) => this.active.get(sessionId)?.controller.abort(),
      run: (sessionId, turnId, worker, version) => this.runContinuation(sessionId, turnId, worker, version),
    });
  }

  private setActive(sessionId: string, turnId: string, seeded = false): SessionExecutionReservation {
    const slot = this.active.reserve(sessionId, turnId, { seeded });
    if (!slot) throw new Error(`Session ${sessionId} is already executing or stopping`);
    this.activeSessionRegistry?.markActive(sessionId);
    return slot;
  }

  private deleteActive(sessionId: string, slot: SessionExecutionReservation): void {
    if (this.active.get(sessionId) !== slot) return;
    this.active.release(sessionId, slot);
    this.activeSessionRegistry?.markInactive(sessionId);
  }

  async runContinuation(sessionId: string, turnId: string, worker: (controller: AbortController) => Promise<boolean>, version?: number): Promise<boolean> {
    const slot = await this.mutex.runExclusive(sessionId, async () => {
      const existing = this.active.get(sessionId);
      if (this.active.isStopping(sessionId) || (version !== undefined && this.active.wasStopped(sessionId, version))) return null;
      if (existing && (!existing.seeded || existing.turnId !== turnId)) return null;
      if (existing?.seeded) this.deleteActive(sessionId, existing);
      const reservation = this.active.reserve(sessionId, turnId, { version });
      if (reservation) this.activeSessionRegistry?.markActive(sessionId);
      return reservation;
    });
    if (!slot) return false;
    try {
      return await worker(slot.controller);
    } finally {
      const next = await this.advance(sessionId, slot);
      if (next) await this.runWithDrain(next);
    }
  }

  async submit(payload: ChatSendPayload, emit: EmitFn): Promise<void> {
    const sid = payload.sessionId;
    const version = this.active.capture();
    const isInterrupt = payload.interrupt === true;
    const stop = this.active.waitForStop(sid);
    if (stop) await stop;

    // Decide+claim atomically per-session. The decision phase mutates
    // `active` and `queues`; without the mutex two concurrent submits for
    // an idle session could both pass the `isActive` check and both call
    // `runWithDrain`, double-booking the session.
    //
    // Interrupts enter the head of the same queue; only the current owner's
    // cleanup can transfer admission to the next turn.
    const decision = await this.mutex.runExclusive<
      | { kind: 'dispatch'; turnId: string }
      | { kind: 'queued' }
      | { kind: 'rejected' }
      | { kind: 'stopping'; barrier: Promise<void> }
    >(sid, async () => {
      if (this.active.wasStopped(sid, version)) {
        emit('chat:error', { sessionId: sid, code: 'QUEUE_DROPPED', message: 'Queued turn was dropped because the session was stopped.', hadContent: false });
        return { kind: 'rejected' };
      }
      const barrier = this.active.waitForStop(sid);
      if (barrier) return { kind: 'stopping', barrier };
      if (isInterrupt && this.active.has(sid)) {
        this.active.get(sid)?.controller.abort();
        this.chat.abort(sid);
        if (payload.content.trim().length === 0) return { kind: 'rejected' };
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
        if (isInterrupt) queue.unshift(queuedItem);
        else queue.push(queuedItem);
        this.queues.set(sid, queue);
        emit('chat:queued', {
          sessionId: sid,
          queueLength: queue.length,
          position: isInterrupt ? 1 : queue.length,
        });
        return { kind: 'queued' };
      }
      // Idle session: claim the active slot before releasing the lock so
      // any concurrent submit will see us as active.
      const turnId = nanoid();
      this.setActive(sid, turnId);
      return { kind: 'dispatch', turnId };
    });

    if (decision.kind === 'queued' || decision.kind === 'rejected') return;

    if (decision.kind === 'stopping') {
      await decision.barrier;
      return this.submit(payload, emit);
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
      if (this.active.has(sessionId) || this.active.isStopping(sessionId)) return null;
      const durableQueue = await this.runJournal!.listQueuedRuns(sessionId);
      if (durableQueue.length === 0) return null;

      const items = durableQueue.map((run): QueuedItem => ({
        emit,
        turnId: run.turnId,
        runId: run.id,
      }));
      const head = items.shift()!;
      if (items.length > 0) this.queues.set(sessionId, items);
      if (this.active.isStopping(sessionId)) return null;
      this.setActive(sessionId, head.turnId);
      return head;
    });

    if (!first) return;
    const slot = this.active.get(sessionId)!;
    let dispatch: DispatchItem | null;
    try {
      dispatch = await this.toDispatchItem(sessionId, first);
    } catch (error) {
      const next = await this.advance(sessionId, slot);
      if (next) void this.runWithDrain(next);
      throw error;
    }
    if (dispatch) { void this.runWithDrain(dispatch); return; }
    const next = await this.advance(sessionId, slot);
    if (next) void this.runWithDrain(next);
  }

  /**
   * Abort the active turn (if any) for a session without dispatching a new one.
   * Used by the explicit chat:stop socket event.
   *
   * Keep admission fenced until the worker and durable queue cleanup settle.
   */
  stop(sessionId: string): void {
    void this.stopAndDrain(sessionId).catch((error: unknown) => {
      this.logger.error(`Stop failed for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /**
   * Abort the active turn, drop queued items, and wait for the current turn to
   * settle before releasing the slot. Used before destructive lifecycle
   * actions like session deletion so message persistence cannot race the row
   * removal.
   */
  async stopAndDrain(sessionId: string): Promise<void> {
    const drain = this.active.stopAndDrain(sessionId, () => this.mutex.runExclusive(sessionId, async () => {
      await this.dropQueuedItems(sessionId);
    }), async () => { await this.chat.cancelPendingContinuations?.(sessionId); });
    this.chat.abort(sessionId);
    await drain;
    if (!this.active.has(sessionId)) this.activeSessionRegistry?.markInactive(sessionId);
  }

  assertStopLeasesAvailable(sessionIds: readonly string[]): void {
    sessionIds.forEach(id => this.active.assertStopLeaseAvailable(id));
  }

  acquireStopLease(sessionId: string, ownersSettled: Promise<void>): SessionStopLease {
    const lease = this.active.acquireStopLease(sessionId, ownersSettled,
      () => this.mutex.runExclusive(sessionId, () => this.dropQueuedItems(sessionId)),
      async () => {
        await this.chat.cancelPendingContinuations(sessionId);
        if (!this.active.has(sessionId)) this.activeSessionRegistry?.markInactive(sessionId);
      });
    this.chat.abort(sessionId);
    return lease;
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
    this.setActive(sessionId, turnId, true);
  }

  clearSeededActiveTurn(sessionId: string): void {
    const slot = this.active.get(sessionId);
    if (slot?.seeded) {
      this.deleteActive(sessionId, slot);
      this.queues.delete(sessionId);
    }
  }

  /**
   * Cancel the in-flight turn (if any) and drop any queued items for the
   * given session. Used on socket disconnect.
   */
  abortAll(sessionId: string): void {
    this.stop(sessionId);
  }

  private async dropQueuedItems(sessionId: string): Promise<void> {
    const queue = this.queues.get(sessionId);
    if (!queue || queue.length === 0) {
      this.queues.delete(sessionId);
      return;
    }

    this.queues.delete(sessionId);
    const errors: unknown[] = [];
    for (const item of queue) {
      if (item.runId) {
        try {
          if (!this.runJournal || !await this.runJournal.cancelQueuedRun(item.runId)) {
            throw new Error('QUEUED_CANCELLATION_CONFLICT');
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`Unable to cancel queued chat run ${item.runId} for session ${sessionId}: ${message}`);
          errors.push(err);
        }
      }
      item.emit('chat:error', {
        sessionId,
        code: 'QUEUE_DROPPED',
        message: 'Queued turn was dropped because the session was stopped.',
        hadContent: false,
      });
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Durable queued chat cancellation failed');
  }

  private async runWithDrain(initial: DispatchItem): Promise<void> {
    const sid = initial.payload.sessionId;
    let current: DispatchItem | null = initial;
    while (current) {
      const slot = this.active.get(sid)!;
      try {
        await this.runOne(current, slot);
      } finally {
        current = await this.advance(sid, slot);
      }
    }
  }

  private advance(sid: string, slot: SessionExecutionReservation): Promise<DispatchItem | null> {
    return this.mutex.runExclusive<DispatchItem | null>(sid, async () => {
        if (this.active.get(sid) !== slot) return null;
        this.deleteActive(sid, slot);
        if (this.active.isStopping(sid)) return null;
        const queue = this.queues.get(sid);
        while (queue && queue.length > 0) {
          const next = queue.shift()!;
          if (queue.length === 0) {
            this.queues.delete(sid);
          }
          const nextSlot = this.setActive(sid, next.turnId);
          let dispatch: DispatchItem | null;
          try {
            dispatch = await this.toDispatchItem(sid, next);
          } catch (error) {
            this.deleteActive(sid, nextSlot);
            throw error;
          }
          if (!dispatch) {
            this.deleteActive(sid, nextSlot);
            if (this.active.isStopping(sid)) return null;
            continue;
          }
          nextSlot.turnId = dispatch.turnId;
          return dispatch;
        }
        this.queues.delete(sid);
        return null;
      });
  }

  private async toDispatchItem(sessionId: string, queued: QueuedItem): Promise<DispatchItem | null> {
    return claimQueuedDispatchItem({
      sessionId,
      queued,
      runJournal: this.runJournal,
      onError: (message) => this.logger.error(message),
    });
  }

  private async runOne(current: DispatchItem, slot: SessionExecutionReservation): Promise<void> {
    const sid = current.payload.sessionId;
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
          slot.controller,
        )
        .catch((err) => {
          // ChatService.handleTurn already swallows its own errors, but be
          // defensive so a thrown error never wedges the pipeline state.
          this.logger.error(
            `handleTurn rejected for session ${sid}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      await executionPromise;
  }
}
