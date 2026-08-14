import type { SocketEvents } from '@kalio/types';
import type { EmitFn } from './interfaces/stream-context.interface';
import type { RunJournalService } from './run-journal.service';

type ChatSendPayload = SocketEvents['chat:send'];

export interface QueuedItem {
  emit: EmitFn;
  turnId: string;
  runId?: string;
  payload?: ChatSendPayload;
}

type QueuePersistenceResult =
  | { kind: 'accepted'; item: QueuedItem }
  | { kind: 'duplicate'; runId: string; turnId: string }
  | { kind: 'rejected'; message: string };

export interface DispatchItem {
  payload: ChatSendPayload;
  emit: EmitFn;
  turnId: string;
  runId?: string;
}

export async function persistQueuedChatRun(options: {
  runJournal: RunJournalService;
  sessionId: string;
  turnId: string;
  payload: ChatSendPayload;
  emit: EmitFn;
}): Promise<QueuePersistenceResult> {
  const { runJournal, sessionId, turnId, payload, emit } = options;
  const queueIdempotencyKey = payload.clientMessageId ?? undefined;

  if (queueIdempotencyKey) {
    const existingRun = await runJournal.findRunByQueueKey(sessionId, queueIdempotencyKey);
    if (existingRun) {
      return { kind: 'duplicate', runId: existingRun.id, turnId: existingRun.turnId };
    }
  }

  try {
    const queuedRun = await runJournal.acceptQueuedRun({
      sessionId,
      turnId,
      queueIdempotencyKey: queueIdempotencyKey ?? turnId,
      queuedPayload: {
        content: payload.content,
        personaId: payload.personaId,
        attachments: payload.attachments,
        clientMessageId: payload.clientMessageId,
      },
    });

    if (queuedRun.turnId !== turnId) {
      return { kind: 'duplicate', runId: queuedRun.id, turnId: queuedRun.turnId };
    }

    return {
      kind: 'accepted',
      item: {
        emit,
        turnId: queuedRun.turnId,
        runId: queuedRun.id,
      },
    };
  } catch (error) {
    return {
      kind: 'rejected',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function queuedRunPosition(queue: QueuedItem[], runId: string): number {
  const index = queue.findIndex((item) => item.runId === runId);
  return index >= 0 ? index + 1 : 0;
}

export async function claimQueuedDispatchItem(options: {
  sessionId: string;
  queued: QueuedItem;
  runJournal?: RunJournalService;
  onError: (message: string) => void;
}): Promise<DispatchItem | null> {
  const { sessionId, queued, runJournal, onError } = options;
  if (queued.payload) {
    return {
      payload: queued.payload,
      emit: queued.emit,
      turnId: queued.turnId,
      runId: queued.runId,
    };
  }

  const claimed = await runJournal?.claimQueuedRun(sessionId, queued.runId);
  if (!claimed) {
    onError(`Queued chat run claim returned no durable run for session ${sessionId}`);
    queued.emit('chat:error', {
      sessionId,
      code: 'RUNTIME_PERSISTENCE_FAILED',
      message: 'Unable to recover queued runtime state. The queued turn was dropped.',
      hadContent: false,
    });
    return null;
  }

  if (claimed.id !== queued.runId || claimed.turnId !== queued.turnId) {
    onError(
      `Queued chat run claim mismatch for session ${sessionId}: expected ${queued.runId ?? 'unknown'}/${queued.turnId}, got ${claimed.id}/${claimed.turnId}`,
    );
  }

  if (!claimed.queuedPayload) {
    onError(`Queued chat run ${claimed.id} for session ${sessionId} has no durable payload`);
    queued.emit('chat:error', {
      sessionId,
      code: 'RUNTIME_PERSISTENCE_FAILED',
      message: 'Unable to recover queued runtime payload. The queued turn was dropped.',
      hadContent: false,
    });
    return null;
  }

  return {
    payload: {
      sessionId,
      content: claimed.queuedPayload.content,
      personaId: claimed.queuedPayload.personaId,
      attachments: claimed.queuedPayload.attachments,
      clientMessageId: claimed.queuedPayload.clientMessageId,
    },
    emit: queued.emit,
    turnId: claimed.turnId,
    runId: claimed.id,
  };
}
