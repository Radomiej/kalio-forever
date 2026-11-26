import { nanoid } from 'nanoid';
import type { ExecutionProfile } from '@kalio/types';
import type { AuditService } from './audit.service';
import type { EmitFn } from './interfaces/stream-context.interface';
import type { LLMAgentLoopRequest } from './llm-turn-runtime.types';
import type { RunJournalService } from './run-journal.service';
import type { SessionsService } from './sessions.service';
import type { BeginManualToolWait } from './interfaces/stream-context.interface';
import type { HitlRequestService } from '../hitl/hitl-request.service';
import { createWorkflowError } from '../../common/utils/workflow-error.util';
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
  onActivity?: (event: string, data: unknown) => void;
  sessions: SessionsService;
  runJournal?: RunJournalService;
  nativeApprovals?: NativeApprovalService;
  audit?: AuditService;
  hitlRequests?: Pick<HitlRequestService, 'create' | 'resolve'>;
  /** Pauses the sub-agent budget while a human answers a native permission. */
  beginManualToolWait?: BeginManualToolWait;
  /** Called when a native permission cannot reach any approval channel. */
  onNativeApprovalUnavailable?: (error: Error) => void;
}): ProviderOptions {
  const audit = input.audit ? createExternalAuditCallback(input.audit, input.sessionId) : undefined;
  return {
    executionProfile: input.executionProfile,
    externalThreadId: input.externalThreadId,
    providerCompletesTurn: input.executionProfile?.kind === 'codex-app-server' || input.executionProfile?.kind === 'claude-agent-sdk' || input.executionProfile?.kind === 'devin-api' || input.executionProfile?.kind === 'devin-cli-acp',
    onExternalThreadBound: async (externalThreadId, binding) => bindExternalRuntime({
      sessions: input.sessions,
      runJournal: input.runJournal,
      sessionId: input.sessionId,
      runId: input.runId,
      externalThreadId,
      binding,
    }),
    onExternalRuntimeLost: input.onExternalRuntimeLost,
    onNativeApprovalRequested: buildNativeApprovalCallback(input),
    onExternalAudit: input.onActivity ? (event) => {
      input.onActivity?.(event.eventName, event.data);
      return audit?.(event);
    } : audit,
  };
}

/** Routes sub-agent native approvals through the branch session's confirmation channel and pauses its budget. */
function buildNativeApprovalCallback(input: Parameters<typeof buildSubagentProviderOptions>[0]): ProviderOptions['onNativeApprovalRequested'] {
  const unavailable = (method: string, params: Record<string, unknown>): Error => {
    const toolCall = params.toolCall as { title?: unknown; name?: unknown } | undefined;
    const label = [toolCall?.title, toolCall?.name].find((value): value is string => typeof value === 'string' && value.length > 0);
    const error = createWorkflowError('CONTRACT_VIOLATION',
      `NATIVE_APPROVAL_UNAVAILABLE: native permission ${method}${label ? ` (${label})` : ''} cannot be answered: no approval channel for sub-agent session ${input.sessionId}.`,
      { source: 'subagent-runtime' });
    input.onNativeApprovalUnavailable?.(error);
    return error;
  };
  const inner = input.nativeApprovals && input.trackingEmit
    ? createNativeApprovalCallback(input.nativeApprovals, {
      sessionId: input.sessionId,
      turnId: input.turnId,
      runId: input.runId,
      emit: input.trackingEmit,
      abortSignal: input.abortSignal,
      hitlRequests: input.hitlRequests,
    })
    : undefined;
  return async (request) => {
    if (!inner) throw unavailable(request.method, request.params);
    const release = input.beginManualToolWait?.(`native-approval:${nanoid()}`);
    try { return await inner(request); } finally { release?.(); }
  };
}