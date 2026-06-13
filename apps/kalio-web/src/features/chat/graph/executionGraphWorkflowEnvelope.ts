import type { ChatMessage } from '@kalio/types';
import type { AgentTurn } from '../../../store/sessionStore';

export function findWorkflowEnvelopeArchitectureMessage(
  turn: AgentTurn,
  messages: ChatMessage[],
  messageById: ReadonlyMap<string, ChatMessage>,
  finalMessage: ChatMessage | null,
): ChatMessage | null {
  if (finalMessage?.architectureRun) {
    return finalMessage;
  }

  for (const item of turn.items) {
    if (item.kind === 'text') {
      const message = messageById.get(item.messageId);
      if (message?.architectureRun) {
        return message;
      }
    }

    if (item.kind === 'tool') {
      const message = messages.find((candidate) => (
        candidate.role === 'assistant'
        && candidate.architectureRun
        && candidate.toolCalls?.some((toolCall) => toolCall.id === item.callId)
      ));
      if (message) {
        return message;
      }
    }
  }

  return null;
}
