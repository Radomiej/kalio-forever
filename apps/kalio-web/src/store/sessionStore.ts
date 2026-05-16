import { create } from 'zustand';
import type { AgentRunContext, ChatSession, ChatMessage, ID } from '@kalio/types';
import { useAgentStore } from './agentStore';
import type { AgentTurn, AgentTurnItem } from './sessionStore.helpers';
import {
  getStoredSessionActiveTurnId,
  getStoredSessionMessages,
  getStoredSessionTurns,
  mergePendingMessages,
  resolveSessionSlice,
} from './sessionStore.helpers';

export type { AgentTurn, AgentTurnItem } from './sessionStore.helpers';

interface SessionState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  sessionMessages: Record<string, ChatMessage[]>;
  streamingChunks: Record<string, string>;    // messageId → accumulated answer delta
  thinkingChunks: Record<string, string>;     // messageId → accumulated thinking delta
  chunkSessionIds: Record<string, string>;    // messageId → sessionId (cross-session isolation)
  pendingMessage: string | null;
  pendingRAAppId: string | null;
  pendingUserActions: string[];

  // Agent turns (unified chronological rendering)
  agentTurns: AgentTurn[];
  sessionAgentTurns: Record<string, AgentTurn[]>;
  activeTurnId: ID | null;  // current turn being built (between agent:start and agent:done)
  sessionActiveTurnIds: Record<string, ID | null>;

  setSessions: (sessions: ChatSession[]) => void;
  addSession: (session: ChatSession) => void;
  createSession: (name: string) => string;
  setActiveSession: (id: string | null) => void;
  getSessionMessages: (sessionId: string | null) => ChatMessage[];
  getSessionAgentTurns: (sessionId: string | null) => AgentTurn[];
  getSessionActiveTurnId: (sessionId: string | null) => ID | null;
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
  addMessage: (message: ChatMessage) => void;
  appendChunk: (messageId: string, delta: string, thinking?: boolean, chunkSessionId?: string) => void;
  finalizeChunk: (messageId: string) => void;
  flushThinkingChunks: (sessionId?: string | null) => void;
  flushStreamingChunks: (sessionId?: string | null) => void;
  removeSession: (id: string) => void;
  updateSession: (id: string, patch: Partial<ChatSession>) => void;
  setPendingMessage: (message: string | null) => void;
  setPendingRAAppId: (id: string | null) => void;
  enqueueUserAction: (payload: string) => void;
  dequeueUserAction: () => string | undefined;

  // Agent turn management
  startAgentTurn: (turnId: ID, sessionId: ID, agentRun?: AgentRunContext) => void;
  addTurnItem: (item: AgentTurnItem, sessionId?: string | null) => void;
  finalizeAgentTurn: (sessionId?: string | null) => void;
  clearAgentTurns: (sessionId?: string | null) => void;
  setAgentTurns: (turns: AgentTurn[], sessionId?: string | null) => void;
  markAgentTurnError: (turnId: ID, error: { code: string; message: string }, sessionId?: string | null) => void;
  removeLastAgentTurn: (sessionId?: string | null) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  sessionMessages: {},
  streamingChunks: {},
  thinkingChunks: {},
  chunkSessionIds: {},
  pendingMessage: null,
  pendingRAAppId: null,
  pendingUserActions: [],

  // Agent turns
  agentTurns: [],
  sessionAgentTurns: {},
  activeTurnId: null,
  sessionActiveTurnIds: {},

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
  getSessionMessages: (sessionId) => resolveSessionSlice(get(), sessionId).messages,
  getSessionAgentTurns: (sessionId) => resolveSessionSlice(get(), sessionId).agentTurns,
  getSessionActiveTurnId: (sessionId) => resolveSessionSlice(get(), sessionId).activeTurnId,
  setActiveSession: (id) => {
    // No-op if this session is already active — avoids wiping messages/agentTurns
    // when the same session is re-selected (e.g. user clicks an already-active session
    // or auto-select fires for a session that's already loaded).
    if (get().activeSessionId === id) return;
    useAgentStore.getState().setStreaming(false);
    const slice = resolveSessionSlice(get(), id);
    set({
      activeSessionId: id,
      messages: slice.messages,
      pendingUserActions: [],
      agentTurns: slice.agentTurns,
      activeTurnId: slice.activeTurnId,
    });
  },
  setMessages: (messages, sessionId) =>
    set((s) => {
      const targetSessionId = sessionId ?? s.activeSessionId;
      if (!targetSessionId) return { messages };

      const nextMessages = mergePendingMessages(
        targetSessionId,
        messages,
        s.streamingChunks,
        s.thinkingChunks,
        s.chunkSessionIds,
      );

      return {
        sessionMessages: {
          ...s.sessionMessages,
          [targetSessionId]: nextMessages,
        },
        messages: targetSessionId === s.activeSessionId ? nextMessages : s.messages,
      };
    }),
  addMessage: (message) =>
    set((s) => {
      const nextSessionMessages = [...getStoredSessionMessages(s, message.sessionId), message];
      return {
        sessionMessages: {
          ...s.sessionMessages,
          [message.sessionId]: nextSessionMessages,
        },
        messages: message.sessionId === s.activeSessionId ? nextSessionMessages : s.messages,
      };
    }),

  appendChunk: (messageId, delta, thinking = false, chunkSessionId?) =>
    set((s) => {
      const targetSessionId = chunkSessionId ?? s.activeSessionId;
      if (!targetSessionId) {
        return s;
      }
      const updatedChunkSessionIds = targetSessionId
        ? { ...s.chunkSessionIds, [messageId]: targetSessionId }
        : s.chunkSessionIds;

      const baseMessages = getStoredSessionMessages(s, targetSessionId);
      const msgExists = baseMessages.some((message) => message.id === messageId);
      const nextMessages = msgExists
        ? [...baseMessages]
        : [
            ...baseMessages,
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
          sessionMessages: {
            ...s.sessionMessages,
            [targetSessionId]: nextMessages,
          },
          messages: targetSessionId === s.activeSessionId ? nextMessages : s.messages,
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
        const nextThinkingChunks = { ...s.thinkingChunks };
        delete nextThinkingChunks[messageId];
        const nextMessagesWithThinking = nextMessages.map((message) =>
          message.id === messageId ? { ...message, thinking: thinkingContent } : message,
        );
        return {
          chunkSessionIds: updatedChunkSessionIds,
          sessionMessages: {
            ...s.sessionMessages,
            [targetSessionId]: nextMessagesWithThinking,
          },
          messages: targetSessionId === s.activeSessionId ? nextMessagesWithThinking : s.messages,
          thinkingChunks: nextThinkingChunks,
          streamingChunks: {
            ...s.streamingChunks,
            [messageId]: (s.streamingChunks[messageId] ?? '') + delta,
          },
        };
      }

      return {
        chunkSessionIds: updatedChunkSessionIds,
        sessionMessages: {
          ...s.sessionMessages,
          [targetSessionId]: nextMessages,
        },
        messages: targetSessionId === s.activeSessionId ? nextMessages : s.messages,
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
      const nextStreamingChunks = { ...s.streamingChunks };
      delete nextStreamingChunks[messageId];
      const nextThinkingChunks = { ...s.thinkingChunks };
      delete nextThinkingChunks[messageId];
      const nextChunkSessionIds = { ...s.chunkSessionIds };
      delete nextChunkSessionIds[messageId];
      const nextSessionMessages = targetSessionId
        ? getStoredSessionMessages(s, targetSessionId).map((message) =>
            message.id === messageId
              ? { ...message, content: finalContent, thinking: finalThinking || undefined, streaming: false }
              : message,
          )
        : [];
      return {
        chunkSessionIds: nextChunkSessionIds,
        streamingChunks: nextStreamingChunks,
        thinkingChunks: nextThinkingChunks,
        sessionMessages: targetSessionId
          ? {
              ...s.sessionMessages,
              [targetSessionId]: nextSessionMessages,
            }
          : s.sessionMessages,
        messages: targetSessionId === s.activeSessionId ? nextSessionMessages : s.messages,
      };
    }),

  // Called on tool:start — thinking is done once the agent invokes a tool.
  // Without this, thinkingChunks stay populated (and the bubble keeps animating)
  // when the LLM goes thinking → tool call without emitting a text chunk first.
  flushThinkingChunks: (sessionId) =>
    set((s) => {
      const targetSessionId = sessionId ?? s.activeSessionId;
      if (!targetSessionId) return s;
      const updates = Object.entries(s.thinkingChunks).filter(([messageId]) => s.chunkSessionIds[messageId] === targetSessionId);
      if (updates.length === 0) return s;

      const messageIds = new Set(updates.map(([messageId]) => messageId));
      const nextThinkingChunks = Object.fromEntries(
        Object.entries(s.thinkingChunks).filter(([messageId]) => !messageIds.has(messageId)),
      );
      const nextSessionMessages = getStoredSessionMessages(s, targetSessionId).map((message) => {
        const thinkingContent = updates.find(([messageId]) => messageId === message.id)?.[1];
        return thinkingContent !== undefined ? { ...message, thinking: thinkingContent } : message;
      });

      return {
        thinkingChunks: nextThinkingChunks,
        sessionMessages: {
          ...s.sessionMessages,
          [targetSessionId]: nextSessionMessages,
        },
        messages: targetSessionId === s.activeSessionId ? nextSessionMessages : s.messages,
      };
    }),

  // Called on tool:start — text streaming is done once the agent invokes a tool.
  // Without this, streamingChunks stay populated (and the text cursor keeps blinking)
  // when the LLM writes text then immediately calls a tool in the same response.
  flushStreamingChunks: (sessionId) =>
    set((s) => {
      const targetSessionId = sessionId ?? s.activeSessionId;
      if (!targetSessionId) return s;
      const updates = Object.entries(s.streamingChunks).filter(([messageId]) => s.chunkSessionIds[messageId] === targetSessionId);
      if (updates.length === 0) return s;

      const messageIds = new Set(updates.map(([messageId]) => messageId));
      const nextStreamingChunks = Object.fromEntries(
        Object.entries(s.streamingChunks).filter(([messageId]) => !messageIds.has(messageId)),
      );
      const nextSessionMessages = getStoredSessionMessages(s, targetSessionId).map((message) => {
        const streamContent = updates.find(([messageId]) => messageId === message.id)?.[1];
        return streamContent !== undefined ? { ...message, content: streamContent, streaming: false } : message;
      });

      return {
        streamingChunks: nextStreamingChunks,
        sessionMessages: {
          ...s.sessionMessages,
          [targetSessionId]: nextSessionMessages,
        },
        messages: targetSessionId === s.activeSessionId ? nextSessionMessages : s.messages,
      };
    }),

  removeSession: (id) =>
    set((s) => {
      const nextSessionMessages = { ...s.sessionMessages };
      delete nextSessionMessages[id];
      const nextSessionAgentTurns = { ...s.sessionAgentTurns };
      delete nextSessionAgentTurns[id];
      const nextSessionActiveTurnIds = { ...s.sessionActiveTurnIds };
      delete nextSessionActiveTurnIds[id];
      return {
        sessions: s.sessions.filter((sess) => sess.id !== id),
        activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
        messages: s.activeSessionId === id ? [] : s.messages,
        agentTurns: s.activeSessionId === id ? [] : s.agentTurns,
        activeTurnId: s.activeSessionId === id ? null : s.activeTurnId,
        sessionMessages: nextSessionMessages,
        sessionAgentTurns: nextSessionAgentTurns,
        sessionActiveTurnIds: nextSessionActiveTurnIds,
      };
    }),

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
  startAgentTurn: (turnId, sessionId, agentRun) =>
    set((s) => {
      const promptMessageId = [...getStoredSessionMessages(s, sessionId)]
        .reverse()
        .find((message) => message.role === 'user')?.id;
      const nextSessionTurns = [
        ...getStoredSessionTurns(s, sessionId),
        { id: turnId, sessionId, promptMessageId, agentRun, items: [], done: false },
      ];
      return {
        sessionAgentTurns: {
          ...s.sessionAgentTurns,
          [sessionId]: nextSessionTurns,
        },
        sessionActiveTurnIds: {
          ...s.sessionActiveTurnIds,
          [sessionId]: turnId,
        },
        agentTurns: sessionId === s.activeSessionId ? nextSessionTurns : s.agentTurns,
        activeTurnId: sessionId === s.activeSessionId ? turnId : s.activeTurnId,
      };
    }),

  addTurnItem: (item, sessionId) =>
    set((s) => {
      const targetSessionId = sessionId ?? s.activeSessionId;
      if (!targetSessionId) return s;

      const targetTurnId = getStoredSessionActiveTurnId(s, targetSessionId);
      if (!targetTurnId) return s;

      const nextSessionTurns = getStoredSessionTurns(s, targetSessionId).map((turn) =>
        turn.id === targetTurnId
          ? { ...turn, items: [...turn.items, item] }
          : turn,
      );

      return {
        sessionAgentTurns: {
          ...s.sessionAgentTurns,
          [targetSessionId]: nextSessionTurns,
        },
        agentTurns: targetSessionId === s.activeSessionId ? nextSessionTurns : s.agentTurns,
      };
    }),

  finalizeAgentTurn: (sessionId) =>
    set((s) => ({
      ...(sessionId ?? s.activeSessionId)
        ? (() => {
            const targetSessionId = sessionId ?? s.activeSessionId;
            if (!targetSessionId) return {};
            const targetTurnId = getStoredSessionActiveTurnId(s, targetSessionId);
            const nextSessionTurns = getStoredSessionTurns(s, targetSessionId).map((turn) =>
              turn.id === targetTurnId ? { ...turn, done: true } : turn,
            );
            return {
              sessionAgentTurns: {
                ...s.sessionAgentTurns,
                [targetSessionId]: nextSessionTurns,
              },
              sessionActiveTurnIds: {
                ...s.sessionActiveTurnIds,
                [targetSessionId]: null,
              },
              agentTurns: targetSessionId === s.activeSessionId ? nextSessionTurns : s.agentTurns,
              activeTurnId: targetSessionId === s.activeSessionId ? null : s.activeTurnId,
            };
          })()
        : {},
    })),

  clearAgentTurns: (sessionId) =>
    set((s) => {
      const targetSessionId = sessionId ?? s.activeSessionId;
      if (!targetSessionId) return { agentTurns: [], activeTurnId: null };
      return {
        sessionAgentTurns: {
          ...s.sessionAgentTurns,
          [targetSessionId]: [],
        },
        sessionActiveTurnIds: {
          ...s.sessionActiveTurnIds,
          [targetSessionId]: null,
        },
        agentTurns: targetSessionId === s.activeSessionId ? [] : s.agentTurns,
        activeTurnId: targetSessionId === s.activeSessionId ? null : s.activeTurnId,
      };
    }),

  setAgentTurns: (turns, sessionId) =>
    set((s) => {
      const targetSessionId = sessionId ?? s.activeSessionId;
      if (!targetSessionId) return { agentTurns: turns, activeTurnId: null };
      return {
        sessionAgentTurns: {
          ...s.sessionAgentTurns,
          [targetSessionId]: turns,
        },
        sessionActiveTurnIds: {
          ...s.sessionActiveTurnIds,
          [targetSessionId]: null,
        },
        agentTurns: targetSessionId === s.activeSessionId ? turns : s.agentTurns,
        activeTurnId: targetSessionId === s.activeSessionId ? null : s.activeTurnId,
      };
    }),

  markAgentTurnError: (turnId, error, sessionId) =>
    set((s) => {
      const targetSessionId = sessionId ?? s.activeSessionId;
      if (!targetSessionId) return s;
      const nextSessionTurns = getStoredSessionTurns(s, targetSessionId).map((turn) =>
        turn.id === turnId ? { ...turn, error } : turn,
      );
      return {
        sessionAgentTurns: {
          ...s.sessionAgentTurns,
          [targetSessionId]: nextSessionTurns,
        },
        agentTurns: targetSessionId === s.activeSessionId ? nextSessionTurns : s.agentTurns,
      };
    }),

  removeLastAgentTurn: (sessionId) =>
    set((s) => {
      const targetSessionId = sessionId ?? s.activeSessionId;
      if (!targetSessionId) return s;
      const turns = getStoredSessionTurns(s, targetSessionId);
      const lastIdx = turns.map((turn) => turn.sessionId).lastIndexOf(targetSessionId);
      if (lastIdx === -1) return s;
      const nextSessionTurns = turns.filter((_, index) => index !== lastIdx);
      return {
        sessionAgentTurns: {
          ...s.sessionAgentTurns,
          [targetSessionId]: nextSessionTurns,
        },
        sessionActiveTurnIds: {
          ...s.sessionActiveTurnIds,
          [targetSessionId]: null,
        },
        agentTurns: targetSessionId === s.activeSessionId ? nextSessionTurns : s.agentTurns,
        activeTurnId: targetSessionId === s.activeSessionId ? null : s.activeTurnId,
      };
    }),
}));
