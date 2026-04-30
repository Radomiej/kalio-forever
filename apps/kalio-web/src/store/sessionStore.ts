import { create } from 'zustand';
import type { ChatSession, ChatMessage, ID } from '@kalio/types';

// ─── Agent Turn (unified chronological items per user prompt) ─────────────────
export type AgentTurnItem =
  | { kind: 'thinking'; messageId: ID }
  | { kind: 'text'; messageId: ID }
  | { kind: 'tool'; callId: ID };   // live or history

export interface AgentTurn {
  id: ID;              // turnId from agent:start
  sessionId: ID;
  items: AgentTurnItem[];  // ordered, append-only
  done: boolean;
  /** Set when the turn ends with a chat:error that had content (mid-turn error). */
  error?: { code: string; message: string };
}

interface SessionState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  streamingChunks: Record<string, string>;    // messageId → accumulated answer delta
  thinkingChunks: Record<string, string>;     // messageId → accumulated thinking delta
  chunkSessionIds: Record<string, string>;    // messageId → sessionId (cross-session isolation)
  pendingMessage: string | null;
  pendingRAAppId: string | null;
  pendingUserActions: string[];

  // Agent turns (unified chronological rendering)
  agentTurns: AgentTurn[];
  activeTurnId: ID | null;  // current turn being built (between agent:start and agent:done)

  setSessions: (sessions: ChatSession[]) => void;
  addSession: (session: ChatSession) => void;
  createSession: (name: string) => string;
  setActiveSession: (id: string | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  appendChunk: (messageId: string, delta: string, thinking?: boolean, chunkSessionId?: string) => void;
  finalizeChunk: (messageId: string) => void;
  flushThinkingChunks: () => void;
  removeSession: (id: string) => void;
  updateSession: (id: string, patch: Partial<ChatSession>) => void;
  setPendingMessage: (message: string | null) => void;
  setPendingRAAppId: (id: string | null) => void;
  enqueueUserAction: (payload: string) => void;
  dequeueUserAction: () => string | undefined;

  // Agent turn management
  startAgentTurn: (turnId: ID, sessionId: ID) => void;
  addTurnItem: (item: AgentTurnItem) => void;
  finalizeAgentTurn: () => void;
  clearAgentTurns: () => void;
  setAgentTurns: (turns: AgentTurn[]) => void;
  markAgentTurnError: (turnId: ID, error: { code: string; message: string }) => void;
  removeLastAgentTurn: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  streamingChunks: {},
  thinkingChunks: {},
  chunkSessionIds: {},
  pendingMessage: null,
  pendingRAAppId: null,
  pendingUserActions: [],

  // Agent turns
  agentTurns: [],
  activeTurnId: null,

  setSessions: (sessions) => set({ sessions }),
  addSession: (session) =>
    set((s) => ({ sessions: [...s.sessions, session] })),
  createSession: (title) => {
    const id = crypto.randomUUID();
    const newSession: ChatSession = {
      id,
      personaId: 'default',
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set((s) => ({ sessions: [...s.sessions, newSession] }));
    return id;
  },
  setActiveSession: (id) => {
    // No-op if this session is already active — avoids wiping messages/agentTurns
    // when the same session is re-selected (e.g. user clicks an already-active session
    // or auto-select fires for a session that's already loaded).
    if (get().activeSessionId === id) return;
    const { streamingChunks, thinkingChunks, chunkSessionIds } = get();
    // Check for in-progress streams belonging to the target session
    const pendingEntries = id ? Object.entries(chunkSessionIds).filter(([, sid]) => sid === id) : [];
    const pendingMessages: ChatMessage[] = pendingEntries.map(([mid]) => ({
      id: mid,
      sessionId: id ?? '',
      role: 'assistant' as const,
      content: streamingChunks[mid] ?? '',
      thinking: thinkingChunks[mid] || undefined,
      streaming: true,
      createdAt: Date.now(),
    }));
    // Restore a synthetic agent turn so the streaming messages are rendered
    const pendingAgentTurns: AgentTurn[] = pendingEntries.length > 0
      ? [{ id: `restoring-${id}`, sessionId: id ?? '', items: pendingEntries.map(([mid]) => ({ kind: 'text' as const, messageId: mid })), done: false }]
      : [];
    set({
      activeSessionId: id,
      messages: pendingMessages,
      pendingUserActions: [],
      agentTurns: pendingAgentTurns,
      activeTurnId: pendingEntries.length > 0 ? `restoring-${id}` : null,
    });
  },
  setMessages: (messages) =>
    set((s) => {
      const activeId = s.activeSessionId;
      // Merge in any in-progress streaming messages for the active session not yet in DB
      const pendingIds = Object.entries(s.chunkSessionIds)
        .filter(([, sid]) => sid === activeId)
        .map(([mid]) => mid);
      const pendingMsgs: ChatMessage[] = pendingIds
        .filter((mid) => !messages.some((m) => m.id === mid))
        .map((mid) => ({
          id: mid,
          sessionId: activeId ?? '',
          role: 'assistant' as const,
          content: s.streamingChunks[mid] ?? '',
          thinking: s.thinkingChunks[mid] || undefined,
          streaming: true,
          createdAt: Date.now(),
        }));
      return { messages: [...messages, ...pendingMsgs] };
    }),
  addMessage: (message) =>
    set((s) => ({ messages: [...s.messages, message] })),

  appendChunk: (messageId, delta, thinking = false, chunkSessionId?) =>
    set((s) => {
      const targetSessionId = chunkSessionId ?? s.activeSessionId ?? '';
      const updatedChunkSessionIds = chunkSessionId
        ? { ...s.chunkSessionIds, [messageId]: targetSessionId }
        : s.chunkSessionIds;

      // Non-active session: accumulate content but do NOT touch messages array
      if (targetSessionId !== s.activeSessionId) {
        if (thinking) {
          return {
            chunkSessionIds: updatedChunkSessionIds,
            thinkingChunks: { ...s.thinkingChunks, [messageId]: (s.thinkingChunks[messageId] ?? '') + delta },
          };
        }
        return {
          chunkSessionIds: updatedChunkSessionIds,
          streamingChunks: { ...s.streamingChunks, [messageId]: (s.streamingChunks[messageId] ?? '') + delta },
        };
      }

      // Active session: ensure the streaming message placeholder exists
      const msgExists = s.messages.some((m) => m.id === messageId);
      const newMessages = msgExists
        ? s.messages
        : [
            ...s.messages,
            {
              id: messageId,
              sessionId: targetSessionId,
              role: 'assistant' as const,
              content: '',
              streaming: true,
              createdAt: Date.now(),
            },
          ];

      if (thinking) {
        return {
          chunkSessionIds: updatedChunkSessionIds,
          messages: newMessages,
          thinkingChunks: {
            ...s.thinkingChunks,
            [messageId]: (s.thinkingChunks[messageId] ?? '') + delta,
          },
        };
      }

      // First text chunk after thinking — flush thinking to message.thinking and clear live chunk
      const hadThinking = s.thinkingChunks[messageId] !== undefined;
      if (hadThinking) {
        const thinkingContent = s.thinkingChunks[messageId];
        const { [messageId]: _removed, ...restThinking } = s.thinkingChunks;
        return {
          chunkSessionIds: updatedChunkSessionIds,
          messages: newMessages.map((m) =>
            m.id === messageId ? { ...m, thinking: thinkingContent } : m,
          ),
          thinkingChunks: restThinking,
          streamingChunks: {
            ...s.streamingChunks,
            [messageId]: (s.streamingChunks[messageId] ?? '') + delta,
          },
        };
      }

      return {
        chunkSessionIds: updatedChunkSessionIds,
        messages: newMessages,
        streamingChunks: {
          ...s.streamingChunks,
          [messageId]: (s.streamingChunks[messageId] ?? '') + delta,
        },
      };
    }),

  finalizeChunk: (messageId) =>
    set((s) => {
      const targetSessionId = s.chunkSessionIds[messageId];
      const finalContent = s.streamingChunks[messageId] ?? '';
      const finalThinking = s.thinkingChunks[messageId] ?? '';
      const { [messageId]: _sc, ...restStreaming } = s.streamingChunks;
      const { [messageId]: _tc, ...restThinking } = s.thinkingChunks;
      const { [messageId]: _csi, ...restChunkSessionIds } = s.chunkSessionIds;
      // Only update messages if this chunk belongs to the currently active session
      const shouldUpdateMessages = !targetSessionId || targetSessionId === s.activeSessionId;
      return {
        chunkSessionIds: restChunkSessionIds,
        streamingChunks: restStreaming,
        thinkingChunks: restThinking,
        messages: shouldUpdateMessages
          ? s.messages.map((m) =>
              m.id === messageId
                ? { ...m, content: finalContent, thinking: finalThinking || undefined, streaming: false }
                : m,
            )
          : s.messages,
      };
    }),

  // Called on tool:start — thinking is done once the agent invokes a tool.
  // Without this, thinkingChunks stay populated (and the bubble keeps animating)
  // when the LLM goes thinking → tool call without emitting a text chunk first.
  flushThinkingChunks: () =>
    set((s) => {
      if (Object.keys(s.thinkingChunks).length === 0) return s;
      const updates = Object.entries(s.thinkingChunks);
      return {
        thinkingChunks: {},
        messages: s.messages.map((m) => {
          const thinkingContent = updates.find(([id]) => id === m.id)?.[1];
          return thinkingContent !== undefined ? { ...m, thinking: thinkingContent } : m;
        }),
      };
    }),

  removeSession: (id) =>
    set((s) => ({
      sessions: s.sessions.filter((sess) => sess.id !== id),
      activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
      messages: s.activeSessionId === id ? [] : s.messages,
    })),

  updateSession: (id, patch) =>
    set((s) => ({
      sessions: s.sessions.map((sess) => (sess.id === id ? { ...sess, ...patch } : sess)),
    })),

  setPendingMessage: (message) => set({ pendingMessage: message }),
  setPendingRAAppId: (id) => set({ pendingRAAppId: id }),
  enqueueUserAction: (payload: string) =>
    set((s) => ({
      pendingUserActions: [...s.pendingUserActions, payload],
    })),
  dequeueUserAction: () => {
    let action: string | undefined;
    set((s) => {
      action = s.pendingUserActions[0];
      return { pendingUserActions: s.pendingUserActions.slice(1) };
    });
    return action;
  },

  // Agent turn management — unified chronological rendering per user prompt
  startAgentTurn: (turnId, sessionId) =>
    set((s) => ({
      agentTurns: [...s.agentTurns, { id: turnId, sessionId, items: [], done: false }],
      activeTurnId: turnId,
    })),

  addTurnItem: (item) =>
    set((s) => {
      if (!s.activeTurnId) return s;
      return {
        agentTurns: s.agentTurns.map((turn) =>
          turn.id === s.activeTurnId
            ? { ...turn, items: [...turn.items, item] }
            : turn
        ),
      };
    }),

  finalizeAgentTurn: () =>
    set((s) => ({
      agentTurns: s.agentTurns.map((turn) =>
        turn.id === s.activeTurnId ? { ...turn, done: true } : turn
      ),
      activeTurnId: null,
    })),

  clearAgentTurns: () => set({ agentTurns: [], activeTurnId: null }),

  setAgentTurns: (turns) => set({ agentTurns: turns, activeTurnId: null }),

  markAgentTurnError: (turnId, error) =>
    set((s) => ({
      agentTurns: s.agentTurns.map((turn) =>
        turn.id === turnId ? { ...turn, error } : turn
      ),
    })),

  removeLastAgentTurn: () =>
    set((s) => {
      if (!s.activeSessionId) return s;
      const sid = s.activeSessionId;
      const lastIdx = s.agentTurns.map((t) => t.sessionId).lastIndexOf(sid);
      if (lastIdx === -1) return s;
      return {
        agentTurns: s.agentTurns.filter((_, i) => i !== lastIdx),
        activeTurnId: null,
      };
    }),
}));
