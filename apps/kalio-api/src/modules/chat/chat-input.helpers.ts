import type { SessionRuntimeContext } from '@kalio/types';
import { nanoid } from 'nanoid';
import { TurnState } from './turn-state';
import type { StreamContext } from './interfaces/stream-context.interface';
import type { RunJournalService } from './run-journal.service';

export function runCheckpoint(journal: RunJournalService | undefined, runId: string | undefined) {
  return async (phase: import('@kalio/types').ChatRunPhase, extra?: Parameters<RunJournalService['checkpoint']>[1]): Promise<void> => {
    if (runId && journal) await journal.checkpoint(runId, { phase, ...extra });
  };
}

export function approvedToolContext(
  identity: Pick<StreamContext, 'sessionId' | 'runId' | 'turnId' | 'runtimeKind' | 'abortSignal' | 'emit'>,
  cursor: Record<string, unknown> & { promptMessageId: string; iteration: number; currentLimit: number },
): StreamContext {
  return {
    ...identity,
    promptMessageId: cursor['promptMessageId'],
    messageId: typeof cursor['messageId'] === 'string' ? cursor['messageId'] : nanoid(),
    vfsSessionId: typeof cursor['vfsSessionId'] === 'string' ? cursor['vfsSessionId'] : undefined,
    historySessionId: typeof cursor['historySessionId'] === 'string' ? cursor['historySessionId'] : undefined,
    iteration: cursor['iteration'], currentLimit: cursor['currentLimit'], state: new TurnState(),
  };
}

export function normalizeClientMessageId(clientMessageId: string | undefined): string | undefined {
  if (!clientMessageId) return undefined;
  const trimmed = clientMessageId.trim();
  return /^[A-Za-z0-9_-]{8,128}$/.test(trimmed) ? trimmed : undefined;
}

export function readExecutionCwd(runtimeContext: SessionRuntimeContext | undefined): string | undefined {
  const value = runtimeContext?.architectureContext?.['executionCwd']
    ?? runtimeContext?.architectureContext?.['projectPath'];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
