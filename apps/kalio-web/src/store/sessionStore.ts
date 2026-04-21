import { create } from 'zustand';
import type { ChatSession, ChatMessage } from '@kalio/types';

interface SessionState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  streamingChunks: Record<string, string>;  // messageId → accumulated delta

  setSessions: (sessions: ChatSession[]) => void;
  addSession: (session: ChatSession) => void;
  setActiveSession: (id: string | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  appendChunk: (messageId: string, delta: string) => void;
  finalizeChunk: (messageId: string) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  streamingChunks: {},

  setSessions: (sessions) => set({ sessions }),
  addSession: (session) =>
    set((s) => ({ sessions: [...s.sessions, session] })),
  setActiveSession: (id) => set({ activeSessionId: id, messages: [] }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((s) => ({ messages: [...s.messages, message] })),
  appendChunk: (messageId, delta) =>
    set((s) => ({
      streamingChunks: {
        ...s.streamingChunks,
        [messageId]: (s.streamingChunks[messageId] ?? '') + delta,
      },
    })),
  finalizeChunk: (messageId) =>
    set((s) => {
      const finalContent = s.streamingChunks[messageId] ?? '';
      const { [messageId]: _, ...rest } = s.streamingChunks;
      return {
        streamingChunks: rest,
        messages: s.messages.map((m) =>
          m.id === messageId
            ? { ...m, content: finalContent, streaming: false }
            : m
        ),
      };
    }),
}));
