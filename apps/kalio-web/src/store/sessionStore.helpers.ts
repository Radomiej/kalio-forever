import type { AgentRunContext, ChatMessage, ID } from '@kalio/types';

export type AgentTurnItem =
  | { kind: 'thinking'; messageId: ID }
  | { kind: 'text'; messageId: ID }
  | { kind: 'tool'; callId: ID };

export interface AgentTurn {
  id: ID;
  sessionId: ID;
  agentRun?: AgentRunContext;
  items: AgentTurnItem[];
  done: boolean;
  error?: { code: string; message: string };
}

export interface SessionProjectionState {
  activeSessionId: string | null;
  messages: ChatMessage[];
  sessionMessages: Record<string, ChatMessage[]>;
  streamingChunks: Record<string, string>;
  thinkingChunks: Record<string, string>;
  chunkSessionIds: Record<string, string>;
  agentTurns: AgentTurn[];
  sessionAgentTurns: Record<string, AgentTurn[]>;
  activeTurnId: ID | null;
  sessionActiveTurnIds: Record<string, ID | null>;
}

export function mergePendingMessages(
  sessionId: string | null,
  baseMessages: ChatMessage[],
  streamingChunks: Record<string, string>,
  thinkingChunks: Record<string, string>,
  chunkSessionIds: Record<string, string>,
): ChatMessage[] {
  if (!sessionId) return [];

  const pendingIds = Object.entries(chunkSessionIds)
    .filter(([, sid]) => sid === sessionId)
    .map(([messageId]) => messageId);

  if (pendingIds.length === 0) return baseMessages;

  const nextMessages = [...baseMessages];
  const indexById = new Map(nextMessages.map((message, index) => [message.id, index]));

  pendingIds.forEach((messageId) => {
    const existingIndex = indexById.get(messageId);
    const content = streamingChunks[messageId] ?? '';
    const thinking = thinkingChunks[messageId];

    if (existingIndex !== undefined) {
      const existing = nextMessages[existingIndex];
      nextMessages[existingIndex] = {
        ...existing,
        content: content || existing.content,
        thinking: thinking ?? existing.thinking,
        streaming: true,
      };
      return;
    }

    nextMessages.push({
      id: messageId,
      sessionId,
      role: 'assistant',
      content,
      thinking: thinking || undefined,
      streaming: true,
      createdAt: Date.now(),
    });
  });

  return nextMessages;
}

export function getStoredSessionMessages(state: SessionProjectionState, sessionId: string | null): ChatMessage[] {
  if (!sessionId) return [];
  return state.sessionMessages[sessionId] ?? (sessionId === state.activeSessionId ? state.messages : []);
}

export function getStoredSessionTurns(state: SessionProjectionState, sessionId: string | null): AgentTurn[] {
  if (!sessionId) return [];
  return state.sessionAgentTurns[sessionId] ?? (sessionId === state.activeSessionId ? state.agentTurns : []);
}

export function getStoredSessionActiveTurnId(state: SessionProjectionState, sessionId: string | null): ID | null {
  if (!sessionId) return null;
  return state.sessionActiveTurnIds[sessionId] ?? (sessionId === state.activeSessionId ? state.activeTurnId : null);
}

function buildRestoredTurn(sessionId: string | null, chunkSessionIds: Record<string, string>): { agentTurns: AgentTurn[]; activeTurnId: ID | null } {
  if (!sessionId) return { agentTurns: [], activeTurnId: null };

  const pendingIds = Object.entries(chunkSessionIds)
    .filter(([, sid]) => sid === sessionId)
    .map(([messageId]) => messageId);

  if (pendingIds.length === 0) return { agentTurns: [], activeTurnId: null };

  const turnId = `restoring-${sessionId}`;
  return {
    agentTurns: [{
      id: turnId,
      sessionId,
      items: pendingIds.map((messageId) => ({ kind: 'text' as const, messageId })),
      done: false,
    }],
    activeTurnId: turnId,
  };
}

export function resolveSessionSlice(state: SessionProjectionState, sessionId: string | null): {
  messages: ChatMessage[];
  agentTurns: AgentTurn[];
  activeTurnId: ID | null;
} {
  if (!sessionId) {
    return { messages: [], agentTurns: [], activeTurnId: null };
  }

  const storedMessages = getStoredSessionMessages(state, sessionId);
  const messages = mergePendingMessages(sessionId, storedMessages, state.streamingChunks, state.thinkingChunks, state.chunkSessionIds);
  const storedTurns = getStoredSessionTurns(state, sessionId);
  const storedActiveTurnId = getStoredSessionActiveTurnId(state, sessionId);

  if (storedTurns.length > 0 || storedActiveTurnId) {
    return {
      messages,
      agentTurns: storedTurns,
      activeTurnId: storedActiveTurnId,
    };
  }

  const restored = buildRestoredTurn(sessionId, state.chunkSessionIds);
  return {
    messages,
    agentTurns: restored.agentTurns,
    activeTurnId: restored.activeTurnId,
  };
}