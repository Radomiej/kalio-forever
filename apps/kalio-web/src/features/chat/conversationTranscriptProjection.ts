import type { ChatMessage, ChatSession } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';
import { architectureSessionSurfaceForSession } from '../sessions/architectureSessionContext';
import { stripArchitectureRuntimeScaffold } from './architectureTraceContent';

interface ConversationTranscriptProjectionInput {
  session: ChatSession | null;
  messages: ChatMessage[];
  agentTurns: AgentTurn[];
}

interface ConversationTranscriptProjection {
  messages: ChatMessage[];
  agentTurns: AgentTurn[];
}

function sanitizeBranchMessageContent(message: ChatMessage): ChatMessage | null {
  if (message.role === 'tool_result') {
    return message;
  }

  const nextContent = stripArchitectureRuntimeScaffold(message.content);
  const nextThinking = message.thinking
    ? stripArchitectureRuntimeScaffold(message.thinking)
    : undefined;
  const hasRenderableText = nextContent.trim().length > 0 || (nextThinking?.trim().length ?? 0) > 0;
  const mustPreserveEnvelope = (message.toolCalls?.length ?? 0) > 0 || (message.attachments?.length ?? 0) > 0;

  if (!hasRenderableText && !mustPreserveEnvelope) {
    return null;
  }

  if (nextContent === message.content && nextThinking === message.thinking) {
    return message;
  }

  return {
    ...message,
    content: nextContent,
    thinking: nextThinking && nextThinking.trim().length > 0 ? nextThinking : undefined,
  };
}

function projectTurnsForRenderableMessages(
  turns: AgentTurn[],
  keptMessageIds: Set<string>,
): AgentTurn[] {
  return turns.flatMap((turn) => {
    const items = turn.items.filter((item) => {
      if (item.kind === 'tool') {
        return true;
      }
      return keptMessageIds.has(item.messageId);
    });

    if (items.length === 0 && turn.done) {
      return [];
    }

    return [{ ...turn, items }];
  });
}

export function resolveRenderableConversationProjection({
  session,
  messages,
  agentTurns,
}: ConversationTranscriptProjectionInput): ConversationTranscriptProjection {
  if (!session || architectureSessionSurfaceForSession(session) !== 'conversation-branch') {
    return { messages, agentTurns };
  }

  const projectedMessages = messages.flatMap((message) => {
    const projected = sanitizeBranchMessageContent(message);
    return projected ? [projected] : [];
  });
  const keptMessageIds = new Set(projectedMessages.map((message) => message.id));

  return {
    messages: projectedMessages,
    agentTurns: projectTurnsForRenderableMessages(agentTurns, keptMessageIds),
  };
}
