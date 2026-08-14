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

function removeSupersededWorkflowEnvelopes(
  messages: ChatMessage[],
  turns: AgentTurn[],
): ConversationTranscriptProjection {
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const turnHasTypedProjection = (turn: AgentTurn) => turn.items.some((item) =>
    item.kind !== 'tool' && Boolean(messagesById.get(item.messageId)?.architectureRun));
  const projectedPromptIds = new Set(
    turns
      .filter(turnHasTypedProjection)
      .map((turn) => turn.promptMessageId)
      .filter((id): id is string => Boolean(id)),
  );
  if (projectedPromptIds.size === 0) return { messages, agentTurns: turns };

  const removedMessageIds = new Set<string>();
  const agentTurns = turns.filter((turn) => {
    const superseded = turn.turnKind === 'workflow-envelope'
      && !turn.done
      && !turnHasTypedProjection(turn)
      && Boolean(turn.promptMessageId && projectedPromptIds.has(turn.promptMessageId));
    if (superseded) {
      turn.items.forEach((item) => {
        if (item.kind !== 'tool') removedMessageIds.add(item.messageId);
      });
    }
    return !superseded;
  });

  return {
    messages: messages.filter((message) => !removedMessageIds.has(message.id)),
    agentTurns,
  };
}

export function resolveRenderableConversationProjection({
  session,
  messages,
  agentTurns,
}: ConversationTranscriptProjectionInput): ConversationTranscriptProjection {
  const workflowProjection = removeSupersededWorkflowEnvelopes(messages, agentTurns);
  if (!session || architectureSessionSurfaceForSession(session) !== 'conversation-branch') {
    return workflowProjection;
  }

  const projectedMessages = workflowProjection.messages.flatMap((message) => {
    const projected = sanitizeBranchMessageContent(message);
    return projected ? [projected] : [];
  });
  const keptMessageIds = new Set(projectedMessages.map((message) => message.id));

  return {
    messages: projectedMessages,
    agentTurns: projectTurnsForRenderableMessages(workflowProjection.agentTurns, keptMessageIds),
  };
}
