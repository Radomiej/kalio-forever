import { create } from 'zustand';
import { createChunkActions, mergeThinkingSnapshots } from './sessionStore.chunks';
import type { AgentRunContext, ChatSession, ChatMessage, ID, RAAppLaunchIntent } from '@kalio/types';
import type { SessionHistoryMeta } from '../features/chat/sessionHistoryApi';
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

export interface SessionState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  sessionMessages: Record<string, ChatMessage[]>;
  sessionHistoryMeta: Record<string, SessionHistoryMeta>;
  hydratedSessionIds: Record<string, true>;
  streamingChunks: Record<string, string>;    // messageId → accumulated answer delta
  thinkingChunks: Record<string, string>;     // messageId → accumulated thinking delta
  chunkSessionIds: Record<string, string>;    // messageId → sessionId (cross-session isolation)
  pendingMessage: string | null;
  pendingRAAppLaunchIntent: RAAppLaunchIntent | null;
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
  getSessionHistoryMeta: (sessionId: string | null) => SessionHistoryMeta | null;
  getSessionAgentTurns: (sessionId: string | null) => AgentTurn[];
  getSessionActiveTurnId: (sessionId: string | null) => ID | null;
  isSessionHydrated: (sessionId: string | null) => boolean;
  markSessionHydrated: (sessionId: string | null) => void;
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
  setSessionHistoryMeta: (sessionId: string | null, meta: SessionHistoryMeta | null) => void;
  addMessage: (message: ChatMessage) => void;
  appendChunk: (messageId: string, delta: string, thinking?: boolean, chunkSessionId?: string) => void;
  finalizeChunk: (messageId: string) => void;
  clearPendingChunks: (sessionId?: string | null) => void;
  flushThinkingChunks: (sessionId?: string | null) => void;
  flushStreamingChunks: (sessionId?: string | null) => void;
  removeSession: (id: string) => void;
  updateSession: (id: string, patch: Partial<ChatSession>) => void;
  setPendingMessage: (message: string | null) => void;
  setPendingRAAppLaunchIntent: (intent: RAAppLaunchIntent | null) => void;
  enqueueUserAction: (payload: string) => void;
  dequeueUserAction: () => string | undefined;

  // Agent turn management
  startAgentTurn: (turnId: ID, sessionId: ID, agentRun?: AgentRunContext, promptMessageId?: ID) => void;
  addTurnItem: (item: AgentTurnItem, sessionId?: string | null) => void;
  finalizeAgentTurn: (sessionId?: string | null, expectedTurnId?: ID | null) => void;
  clearAgentTurns: (sessionId?: string | null) => void;
  setAgentTurns: (turns: AgentTurn[], sessionId?: string | null) => void;
  updateAgentTurn: (turnId: ID, patch: Partial<AgentTurn>, sessionId?: string | null) => void;
  markAgentTurnError: (turnId: ID, error: { code: string; message: string }, sessionId?: string | null) => void;
  removeLastAgentTurn: (sessionId?: string | null) => void;
}

function canMaterializeSession(id: string, patch: Partial<ChatSession>): patch is ChatSession {
  return id.length > 0
    && typeof patch.personaId === 'string'
    && typeof patch.title === 'string'
    && typeof patch.createdAt === 'number'
    && typeof patch.updatedAt === 'number';
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  sessionMessages: {},
  sessionHistoryMeta: {},
  hydratedSessionIds: {},
  streamingChunks: {},
  thinkingChunks: {},
  chunkSessionIds: {},
  pendingMessage: null,
  pendingRAAppLaunchIntent: null,
  pendingUserActions: [],

  // Agent turns
  agentTurns: [],
  sessionAgentTurns: {},
  activeTurnId: null,
  sessionActiveTurnIds: {},

  setSessions: (sessions) => set({ sessions }),
  addSession: (session) =>
    set((s) => ({
      sessions: s.sessions.some((item) => item.id === session.id)
        ? s.sessions.map((item) => item.id === session.id ? { ...item, ...session } : item)
        : [...s.sessions, session],
    })),
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
  getSessionHistoryMeta: (sessionId) => (sessionId ? get().sessionHistoryMeta[sessionId] ?? null : null),
  getSessionAgentTurns: (sessionId) => resolveSessionSlice(get(), sessionId).agentTurns,
  getSessionActiveTurnId: (sessionId) => resolveSessionSlice(get(), sessionId).activeTurnId,
  isSessionHydrated: (sessionId) => (sessionId ? get().hydratedSessionIds[sessionId] === true : false),
  markSessionHydrated: (sessionId) =>
    set((s) => {
      if (!sessionId || s.hydratedSessionIds[sessionId]) {
        return s;
      }
      return {
        hydratedSessionIds: {
          ...s.hydratedSessionIds,
          [sessionId]: true,
        },
      };
    }),
  setActiveSession: (id) => {
    // No-op if this session is already active — avoids wiping messages/agentTurns
    // when the same session is re-selected (e.g. user clicks an already-active session
    // or auto-select fires for a session that's already loaded).
    if (get().activeSessionId === id) return;
    useAgentStore.getState().setStreaming(false, undefined, get().activeSessionId);
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

      const thinkingChunks = { ...s.thinkingChunks };
      for (const message of messages) {
        if (s.chunkSessionIds[message.id] === targetSessionId && thinkingChunks[message.id] !== undefined) {
          thinkingChunks[message.id] = mergeThinkingSnapshots(thinkingChunks[message.id], message.thinking) ?? '';
        }
      }
      const nextMessages = mergePendingMessages(
        targetSessionId,
        messages,
        s.streamingChunks,
        thinkingChunks,
        s.chunkSessionIds,
      );

      return {
        thinkingChunks,
        sessionMessages: {
          ...s.sessionMessages,
          [targetSessionId]: nextMessages,
        },
        messages: targetSessionId === s.activeSessionId ? nextMessages : s.messages,
      };
    }),
  setSessionHistoryMeta: (sessionId, meta) =>
    set((s) => {
      if (!sessionId) {
        return s;
      }
      if (!meta) {
        if (!s.sessionHistoryMeta[sessionId]) {
          return s;
        }
        const nextSessionHistoryMeta = { ...s.sessionHistoryMeta };
        delete nextSessionHistoryMeta[sessionId];
        return { sessionHistoryMeta: nextSessionHistoryMeta };
      }
      return {
        sessionHistoryMeta: {
          ...s.sessionHistoryMeta,
          [sessionId]: meta,
        },
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

  ...createChunkActions(set),

  removeSession: (id) =>
    set((s) => {
      const nextSessionMessages = { ...s.sessionMessages };
      delete nextSessionMessages[id];
      const nextSessionHistoryMeta = { ...s.sessionHistoryMeta };
      delete nextSessionHistoryMeta[id];
      const nextHydratedSessionIds = { ...s.hydratedSessionIds };
      delete nextHydratedSessionIds[id];
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
        sessionHistoryMeta: nextSessionHistoryMeta,
        hydratedSessionIds: nextHydratedSessionIds,
        sessionAgentTurns: nextSessionAgentTurns,
        sessionActiveTurnIds: nextSessionActiveTurnIds,
      };
    }),

  updateSession: (id, patch) =>
    set((s) => {
      const existing = s.sessions.find((sess) => sess.id === id);
      if (existing) {
        return {
          sessions: s.sessions.map((sess) => (sess.id === id ? { ...sess, ...patch } : sess)),
        };
      }
      if (!canMaterializeSession(id, patch)) {
        return { sessions: s.sessions };
      }
      return {
        sessions: [...s.sessions, { ...patch, id }],
      };
    }),

  setPendingMessage: (message) => set({ pendingMessage: message }),
  setPendingRAAppLaunchIntent: (intent) => set({ pendingRAAppLaunchIntent: intent }),
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
  startAgentTurn: (turnId, sessionId, agentRun, explicitPromptMessageId) =>
    set((s) => {
      const existingTurns = getStoredSessionTurns(s, sessionId);
      const existingTurn = existingTurns.find((turn) => turn.id === turnId) ?? null;
      const promptMessageId = explicitPromptMessageId ?? [...getStoredSessionMessages(s, sessionId)]
        .reverse()
        .find((message) => message.role === 'user')?.id;
      const nextSessionTurns = existingTurn
        ? existingTurns.map((turn) => (
          turn.id === turnId
            ? {
                ...turn,
                done: false,
                agentRun: agentRun ?? turn.agentRun,
                promptMessageId: explicitPromptMessageId ?? turn.promptMessageId ?? promptMessageId,
              }
            : turn
        ))
        : [
            ...existingTurns,
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

  finalizeAgentTurn: (sessionId, expectedTurnId) =>
    set((s) => ({
      ...(sessionId ?? s.activeSessionId)
        ? (() => {
            const targetSessionId = sessionId ?? s.activeSessionId;
            if (!targetSessionId) return {};
            const targetTurnId = getStoredSessionActiveTurnId(s, targetSessionId);
            if (expectedTurnId !== undefined && targetTurnId !== expectedTurnId) return {};
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
      const nextActiveTurnId = [...turns].reverse().find((turn) => !turn.done)?.id ?? null;
      return {
        sessionAgentTurns: {
          ...s.sessionAgentTurns,
          [targetSessionId]: turns,
        },
        sessionActiveTurnIds: {
          ...s.sessionActiveTurnIds,
          [targetSessionId]: nextActiveTurnId,
        },
        agentTurns: targetSessionId === s.activeSessionId ? turns : s.agentTurns,
        activeTurnId: targetSessionId === s.activeSessionId ? nextActiveTurnId : s.activeTurnId,
      };
    }),

  updateAgentTurn: (turnId, patch, sessionId) =>
    set((s) => {
      const targetSessionId = sessionId ?? s.activeSessionId;
      if (!targetSessionId) return s;
      const nextSessionTurns = getStoredSessionTurns(s, targetSessionId).map((turn) =>
        turn.id === turnId ? { ...turn, ...patch } : turn,
      );
      return {
        sessionAgentTurns: {
          ...s.sessionAgentTurns,
          [targetSessionId]: nextSessionTurns,
        },
        agentTurns: targetSessionId === s.activeSessionId ? nextSessionTurns : s.agentTurns,
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
