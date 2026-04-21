import { create } from 'zustand';
import type { ChatSession, ChatMessage } from '@kalio/types';

interface SessionState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  streamingChunks: Record<string, string>;    // messageId → accumulated answer delta
  thinkingChunks: Record<string, string>;     // messageId → accumulated thinking delta

  setSessions: (sessions: ChatSession[]) => void;
  addSession: (session: ChatSession) => void;
  createSession: (name: string) => string;
  setActiveSession: (id: string | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  appendChunk: (messageId: string, delta: string, thinking?: boolean) => void;
  finalizeChunk: (messageId: string) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  streamingChunks: {},
  thinkingChunks: {},

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
  setActiveSession: (id) => set({ activeSessionId: id, messages: [] }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((s) => ({ messages: [...s.messages, message] })),

  appendChunk: (messageId, delta, thinking = false) =>
    set((s) => {
      // Ensure the streaming message placeholder exists
      const msgExists = s.messages.some((m) => m.id === messageId);
      const newMessages = msgExists
        ? s.messages
        : [
            ...s.messages,
            {
              id: messageId,
              sessionId: s.activeSessionId ?? '',
              role: 'assistant' as const,
              content: '',
              streaming: true,
              createdAt: Date.now(),
            },
          ];

      if (thinking) {
        return {
          messages: newMessages,
          thinkingChunks: {
            ...s.thinkingChunks,
            [messageId]: (s.thinkingChunks[messageId] ?? '') + delta,
          },
        };
      }
      return {
        messages: newMessages,
        streamingChunks: {
          ...s.streamingChunks,
          [messageId]: (s.streamingChunks[messageId] ?? '') + delta,
        },
      };
    }),

  finalizeChunk: (messageId) =>
    set((s) => {
      const finalContent = s.streamingChunks[messageId] ?? '';
      const { [messageId]: _sc, ...restStreaming } = s.streamingChunks;
      const { [messageId]: _tc, ...restThinking } = s.thinkingChunks;
      return {
        streamingChunks: restStreaming,
        thinkingChunks: restThinking,
        messages: s.messages.map((m) =>
          m.id === messageId
            ? { ...m, content: finalContent, streaming: false }
            : m,
        ),
      };
    }),
}));
