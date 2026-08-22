import type { RunJournalService } from './run-journal.service';
import type { SessionsService } from './sessions.service';

export async function bindExternalRuntime(input: {
  sessions: Pick<SessionsService, 'bindExternalThread'>;
  runJournal?: Pick<RunJournalService, 'checkpoint'>;
  sessionId: string;
  runId?: string;
  externalThreadId: string;
  binding?: { turnId?: string; processEpoch?: string };
}): Promise<void> {
  await input.sessions.bindExternalThread(input.sessionId, input.externalThreadId);
  if (!input.runId || !input.runJournal) return;
  await input.runJournal.checkpoint(input.runId, {
    externalThreadId: input.externalThreadId,
    ...(input.binding?.turnId ? { externalTurnId: input.binding.turnId } : {}),
    ...(input.binding?.processEpoch ? { processEpoch: input.binding.processEpoch } : {}),
  });
}
