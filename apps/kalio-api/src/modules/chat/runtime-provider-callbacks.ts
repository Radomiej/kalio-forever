import type { AuditService } from './audit.service';
import type { EmitFn } from './interfaces/stream-context.interface';
import type { LLMSourceParams } from './interfaces/llm-source.interface';
import type { NativeApprovalService } from '../agent-runtime/native-approval.service';
import type { HitlRequestService } from '../hitl/hitl-request.service';

export function createNativeApprovalCallback(
  nativeApprovals: NativeApprovalService | undefined,
  input: {
    sessionId: string;
    turnId?: string;
    runId?: string;
    emit: EmitFn;
    abortSignal?: AbortSignal;
    hitlRequests?: Pick<HitlRequestService, 'create' | 'resolve'>;
  },
): LLMSourceParams['onNativeApprovalRequested'] {
  if (!nativeApprovals) return undefined;
  return ({ method, params }) => nativeApprovals.request({
    ...input,
    method,
    params,
    emit: (event, data) => input.emit(event, data),
    persistence: input.hitlRequests ? {
      create: async ({ id, sessionId, turnId, runId, toolCallId, payload }) => {
        const persisted = await input.hitlRequests!.create({
          id,
          kind: 'tool_confirmation',
          sessionId,
          turnId,
          runId,
          toolCallId,
          payload,
          continuation: {
            version: 1,
            kind: 'codex_native_approval',
            executionState: 'pending',
            sessionId,
            turnId,
            runId,
          },
        });
        return persisted.revision;
      },
      resolve: (id, revision, status, outcome) => input.hitlRequests!.resolve(id, revision, status, outcome),
    } : undefined,
  });
}

export function createExternalAuditCallback(
  audit: AuditService,
  sessionId: string,
): LLMSourceParams['onExternalAudit'] {
  return ({ eventName, status, data }) => audit.log({
    sessionId,
    type: 'runtime_event',
    label: eventName,
    data: { status, ...data },
  }).then(() => undefined);
}
