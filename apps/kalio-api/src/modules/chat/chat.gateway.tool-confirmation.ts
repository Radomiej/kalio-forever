import type { SocketEvents } from '@kalio/types';
import type { ChatService } from './chat.service';
import type { EmitFn } from './interfaces/stream-context.interface';
import type { ToolDispatchService } from './tool-dispatch.service';
import { resolveToolConfirmation } from './chat.runtime-hitl';

export async function resolveGatewayToolConfirmation(input: {
  clientId: string;
  payload: SocketEvents['tool:confirm'];
  socketSessions: ReadonlyMap<string, ReadonlySet<string>>;
  toolDispatch: Pick<ToolDispatchService, 'resolveConfirmation'>;
  chatService?: Pick<ChatService, 'approveAndResumeTool'>;
  emit: EmitFn;
  warn: (message: string) => void;
}): Promise<void> {
  if (!input.socketSessions.get(input.clientId)?.has(input.payload.sessionId)) {
    input.warn(`tool:confirm rejected — sessionId=${input.payload.sessionId} not owned by socket ${input.clientId}`);
    return;
  }

  await resolveToolConfirmation({
    payload: input.payload,
    toolDispatch: input.toolDispatch,
    chatService: input.chatService,
    emit: input.emit,
  });
}
