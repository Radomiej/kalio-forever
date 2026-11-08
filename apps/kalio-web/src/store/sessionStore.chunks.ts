import type { StoreApi } from 'zustand';
import type { SessionState } from './sessionStore';
import { getStoredSessionActiveTurnId, getStoredSessionMessages, getStoredSessionTurns, withActiveTurnLinkage } from './sessionStore.helpers';

/** Reconcile snapshots, never deltas. An unrelated legacy tail cannot prove a continuation. */
export function mergeThinkingSnapshots(local: string | undefined, durable: string | undefined): string | undefined {
  if (!local) return durable ?? local;
  if (!durable || local.includes(durable)) return local;
  return durable;
}

type ChunkActions = Pick<SessionState, 'appendChunk' | 'finalizeChunk' | 'clearPendingChunks' | 'flushThinkingChunks' | 'flushStreamingChunks'>;

export function createChunkActions(set: StoreApi<SessionState>['setState']): ChunkActions {
  return {
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
        const activeTurnId = getStoredSessionActiveTurnId(s, targetSessionId);
        const activeTurn = getStoredSessionTurns(s, targetSessionId).find((turn) => turn.id === activeTurnId);
        const nextMessages = msgExists
          ? baseMessages.map((message) =>
              message.id === messageId ? withActiveTurnLinkage(message, activeTurn) : message,
            )
          : [
              ...baseMessages,
              withActiveTurnLinkage({
                id: messageId,
                sessionId: targetSessionId,
                role: 'assistant' as const,
                content: '',
                streaming: true,
                createdAt: Date.now(),
              }, activeTurn),
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
              [messageId]: (s.thinkingChunks[messageId]
                ?? baseMessages.find((message) => message.id === messageId)?.thinking ?? '') + delta,
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
                ? { ...message, content: finalContent, thinking: finalThinking || message.thinking || undefined, streaming: false }
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

    clearPendingChunks: (sessionId) =>
      set((s) => {
        const targetSessionId = sessionId ?? s.activeSessionId;
        if (!targetSessionId) return s;

        const pendingIds = Object.entries(s.chunkSessionIds)
          .filter(([, sid]) => sid === targetSessionId)
          .map(([messageId]) => messageId);

        if (pendingIds.length === 0) {
          return s;
        }

        const pendingIdSet = new Set(pendingIds);

        return {
          streamingChunks: Object.fromEntries(
            Object.entries(s.streamingChunks).filter(([messageId]) => !pendingIdSet.has(messageId)),
          ),
          thinkingChunks: Object.fromEntries(
            Object.entries(s.thinkingChunks).filter(([messageId]) => !pendingIdSet.has(messageId)),
          ),
          chunkSessionIds: Object.fromEntries(
            Object.entries(s.chunkSessionIds).filter(([messageId]) => !pendingIdSet.has(messageId)),
          ),
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

  };
}
