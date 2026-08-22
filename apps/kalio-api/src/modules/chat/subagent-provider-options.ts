import type { ExecutionProfile } from '@kalio/types';
import type { AuditService } from './audit.service';
import type { EmitFn } from './interfaces/stream-context.interface';
import type { LLMAgentLoopRequest } from './llm-turn-runtime.types';
import type { RunJournalService } from './run-journal.service';
import type { SessionsService } from './sessions.service';
import type { NativeApprovalService } from '../agent-runtime/native-approval.service';
import { createExternalAuditCallback, createNativeApprovalCallback } from './runtime-provider-callbacks';
import { bindExternalRuntime } from './runtime-external-binding';

type ProviderOptions = Pick<
  LLMAgentLoopRequest,
  'executionProfile' | 'externalThreadId' | 'providerCompletesTurn' | 'onExternalThreadBound'
  | 'onExternalRuntimeLost' | 'onNativeApprovalRequested' | 'onExternalAudit'
>;

export function buildSubagentProviderOptions(input: {
  executionProfile?: ExecutionProfile;
  externalThreadId?: string;
  sessionId: string;
  turnId: string;
  runId?: string;
  abortSignal: AbortSignal;
  onExternalRuntimeLost?: LLMAgentLoopRequest['onExternalRuntimeLost'];
  trackingEmit?: EmitFn;
  sessions: SessionsService;
  runJournal?: RunJournalService;
  nativeApprovals?: NativeApprovalService;
  audit?: AuditService;
}): ProviderOptions {
  return {
    executionProfile: input.executionProfile,
    externalThreadId: input.externalThreadId,
    providerCompletesTurn: input.executionProfile?.kind === 'codex-app-server' || input.executionProfile?.kind === 'claude-agent-sdk' || input.executionProfile?.kind === 'devin-api',
    onExternalThreadBound: async (externalThreadId, binding) => bindExternalRuntime({
      sessions: input.sessions,
      runJournal: input.runJournal,
      sessionId: input.sessionId,
      runId: input.runId,
      externalThreadId,
      binding,
    }),
    onExternalRuntimeLost: input.onExternalRuntimeLost,
    onNativeApprovalRequested: createNativeApprovalCallback(input.nativeApprovals, {
      sessionId: input.sessionId,
      turnId: input.turnId,
      runId: input.runId,
      emit: input.trackingEmit ?? (() => undefined),
      abortSignal: input.abortSignal,
    }),
    onExternalAudit: input.audit ? createExternalAuditCallback(input.audit, input.sessionId) : undefined,
  };
}
