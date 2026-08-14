import type { SocketEvents, ToolConfirmationRequest } from '@kalio/types';
import type { HitlRequestService } from '../hitl/hitl-request.service';
import type { ChatService } from './chat.service';
import type { EmitFn } from './interfaces/stream-context.interface';
import type { ToolDispatchService } from './tool-dispatch.service';

export function mergePendingToolConfirmations(
  ...sources: readonly ToolConfirmationRequest[][]
): ToolConfirmationRequest[] {
  const byRequestId = new Map<string, ToolConfirmationRequest>();
  sources.flat().forEach((request) => {
    if (!byRequestId.has(request.requestId)) {
      byRequestId.set(request.requestId, request);
    }
  });
  return [...byRequestId.values()];
}

export async function replayPendingToolConfirmations(input: {
  sessionId: string;
  replayedRequestIds: Set<string>;
  toolDispatch: Pick<ToolDispatchService, 'getPendingConfirmations'>;
  hitlRequests?: Pick<HitlRequestService, 'listPendingToolConfirmations'>;
  replay: (request: ToolConfirmationRequest) => void;
}): Promise<void> {
  const durableRequests = input.hitlRequests
    ? await input.hitlRequests.listPendingToolConfirmations(input.sessionId)
    : [];
  for (const request of mergePendingToolConfirmations(
    input.toolDispatch.getPendingConfirmations(input.sessionId),
    durableRequests,
  )) {
    if (input.replayedRequestIds.has(request.requestId)) continue;
    input.replayedRequestIds.add(request.requestId);
    input.replay(request);
  }
}

export async function resolveToolConfirmation(input: {
  payload: SocketEvents['tool:confirm'];
  toolDispatch: Pick<ToolDispatchService, 'resolveConfirmation'>;
  chatService?: Pick<ChatService, 'approveAndResumeTool'>;
  emit: EmitFn;
}): Promise<void> {
  const { payload } = input;
  const status = payload.message
    ? await input.toolDispatch.resolveConfirmation(payload.requestId, payload.sessionId, payload.message)
    : await input.toolDispatch.resolveConfirmation(payload.requestId, payload.sessionId);
  if (status !== 'not_found') return;

  const resumed = await input.chatService?.approveAndResumeTool(
    payload.requestId,
    payload.sessionId,
    payload.message,
    input.emit,
  );
  if (resumed) return;
  input.emit('tool:confirmation_invalidated', {
    requestId: payload.requestId,
    sessionId: payload.sessionId,
    reason: 'not_found',
    message: 'This approval is no longer active.',
  });
}

export async function cancelToolConfirmation(input: {
  payload: SocketEvents['tool:cancel'];
  toolDispatch: Pick<ToolDispatchService, 'cancelConfirmation'>;
  chatService?: Pick<ChatService, 'cancelPendingTool'>;
  emit: EmitFn;
}): Promise<void> {
  const { payload } = input;
  const status = payload.message
    ? await input.toolDispatch.cancelConfirmation(payload.requestId, payload.sessionId, payload.message)
    : await input.toolDispatch.cancelConfirmation(payload.requestId, payload.sessionId);
  if (status !== 'not_found') return;

  const cancelled = await input.chatService?.cancelPendingTool(
    payload.requestId,
    payload.sessionId,
    payload.message,
  );
  input.emit('tool:confirmation_invalidated', cancelled
    ? {
        requestId: payload.requestId,
        sessionId: payload.sessionId,
        reason: 'cancelled',
        ...(payload.message ? { message: payload.message } : {}),
      }
    : {
        requestId: payload.requestId,
        sessionId: payload.sessionId,
        reason: 'not_found',
        message: 'This approval is no longer active.',
      });
}
