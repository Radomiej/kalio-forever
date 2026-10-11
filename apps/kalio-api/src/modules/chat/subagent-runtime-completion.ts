import { nanoid } from 'nanoid';
import type { RunSubagentRequest } from '../tool/subagent-runtime.port';
import type { LLMAgentLoopResult } from './llm-turn-runtime.types';
import type { RunJournalService } from './run-journal.service';
import type { VFSService } from '../vfs/vfs.service';
import { TurnState } from './turn-state';
import { exhaustedLoopResultText } from './subagent-result-text';
import { displayTextFromStructuredOutput } from './subagent-runtime.support';
import { hostReceiptIdentity } from './llm-turn-tool-execution';

export async function completeSubagentRuntime(input: {
  request: RunSubagentRequest;
  childSessionId: string;
  loopResult: LLMAgentLoopResult;
  maxIterations: number;
  streamedText: string;
  turnId: string;
  promptMessageId?: string;
  journalRunId?: string;
  runJournal?: RunJournalService;
  vfs: VFSService;
  persistTerminal: (messageId: string, state: TurnState, context: string) => Promise<string | null>;
  onJournalCommitted: () => void;
  abortSignal: AbortSignal;
}) {
  const { request, childSessionId, loopResult } = input;
  if (request.hostRuntimeReceiptObserver) {
    input.abortSignal.throwIfAborted();
    if (loopResult.exhausted || loopResult.aborted || loopResult.emptyNoToolRetriesExhausted) throw new Error('Host receipt run did not complete successfully.');
  }
  const copiedFiles = request.copyOutputs && request.vfsMode === 'isolated'
    ? input.vfs.copySessionFiles({ fromSessionId: childSessionId, toSessionId: request.parentSessionId,
      targetPrefix: request.copyTargetPrefix ?? `sub-agents/${childSessionId}` }) : [];
  const structuredDisplayText = displayTextFromStructuredOutput(loopResult.structuredOutput);
  const baseResultText = loopResult.exhausted
    ? exhaustedLoopResultText(input.maxIterations, loopResult.finalText || input.streamedText.trim())
    : loopResult.finalText || input.streamedText.trim() || structuredDisplayText || 'Sub-agent completed with no output.';
  let completionMessageId = loopResult.lastMessageId;
  if (loopResult.exhausted || baseResultText === 'Sub-agent completed with no output.') {
    const completionState = new TurnState();
    completionState.replaceText(baseResultText);
    const persisted = await input.persistTerminal(nanoid(), completionState, 'completion fallback');
    if (request.hostRuntimeReceiptObserver && !persisted) throw new Error('Host receipt terminal message persistence failed.');
    if (persisted) completionMessageId = persisted;
  }
  const observer = request.hostRuntimeReceiptObserver;
  if (observer) {
    const identity = hostReceiptIdentity({ runId: input.journalRunId, sessionId: childSessionId,
      turnId: input.turnId, promptMessageId: input.promptMessageId });
    if (!input.runJournal) throw new Error('Host receipts require a durable run journal.');
    await observer.drain(identity);
    input.abortSignal.throwIfAborted();
    const active = await input.runJournal.getTurn(childSessionId, input.turnId);
    if (!active || active.id !== identity.runId || active.sessionId !== identity.sessionId || active.turnId !== identity.turnId
      || active.status !== 'active' || !Number.isSafeInteger(active.revision) || (active.revision ?? 0) < 1) {
      throw new Error('Host receipt journal identity/revision is invalid.');
    }
    input.abortSignal.throwIfAborted();
    const completed = await input.runJournal.completeRequired(identity.runId, active.revision!, {
      finalText: baseResultText, ...(loopResult.structuredOutput === undefined ? {} : { structuredOutput: loopResult.structuredOutput }), messageId: completionMessageId,
    });
    input.onJournalCommitted(); // No later observer failure may overwrite this durable ACK.
    if (completed.id !== identity.runId || completed.sessionId !== identity.sessionId || completed.turnId !== identity.turnId
      || completed.status !== 'completed' || completed.phase !== 'completed'
      || !Number.isSafeInteger(completed.revision) || completed.revision !== active.revision! + 1) {
      throw new Error('Host receipt completion ACK is invalid.');
    }
    await observer.journalComplete(identity, { ...completed, revision: completed.revision!, status: 'completed', phase: 'completed' });
    input.abortSignal.throwIfAborted();
  } else if (input.journalRunId) {
    await input.runJournal?.complete(input.journalRunId, {
      finalText: baseResultText, structuredOutput: loopResult.structuredOutput, messageId: completionMessageId,
    });
  }
  return { copiedFiles, baseResultText, completionMessageId };
}
