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
    set((s) => {
      const accumulated = (s.streamingChunks[messageId] ?? '') + delta;
      // If no message exists for this messageId yet, create a streaming placeholder
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
      return {
        streamingChunks: { ...s.streamingChunks, [messageId]: accumulated },
        messages: newMessages,
      };
    }),
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
