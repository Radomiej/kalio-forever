import { useCallback, useState } from 'react';
import type { ChatMessage } from '@kalio/types';
import { useSessionStore } from '../../../store/sessionStore';
import { reloadSessionHistoryWithArchitectureProjection } from '../architectureReloadHydration';
import { buildTurnsFromHistory, mergeFetchedMessages } from '../chatUtils';
import { DEFAULT_SESSION_HISTORY_LIMIT, fetchSessionHistoryWindow, type SessionHistoryMeta } from '../sessionHistoryApi';

export function useOlderChatHistory(
  sessionId: string | null,
  historyMeta: SessionHistoryMeta | null | undefined,
  setError: (error: string) => void,
) {
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const handleLoadOlderMessages = useCallback(async () => {
    if (!sessionId || !historyMeta?.hasMoreBefore || loadingOlderMessages) return;
    const getState = useSessionStore.getState;
    const { setAgentTurns, setMessages, setSessionHistoryMeta } = getState();
    let baseline = new Set<ChatMessage>();
    setLoadingOlderMessages(true);
    try {
      await reloadSessionHistoryWithArchitectureProjection({
        sessionId,
        getActiveSessionId: () => getState().activeSessionId,
        getSessionMessages: (id) => {
          const messages = getState().getSessionMessages(id);
          baseline = new Set(messages);
          return messages;
        },
        setSessionHistoryMeta,
        setAgentTurns,
        fetchMessages: (id) => fetchSessionHistoryWindow(id, {
          limit: DEFAULT_SESSION_HISTORY_LIMIT,
          beforeMessageId: historyMeta.oldestLoadedMessageId,
        }),
        setMessages: (hydrated, id) => {
          const targetId = id ?? sessionId;
          const liveChanges = getState().getSessionMessages(targetId).filter(message => !baseline.has(message));
          const messages = liveChanges.length ? mergeFetchedMessages(liveChanges, hydrated) : hydrated;
          setMessages(messages, targetId);
          setAgentTurns(buildTurnsFromHistory(messages, targetId), targetId);
        },
      });
    } catch (error: unknown) {
      console.error('[ChatInterface] older history load failed', error instanceof Error ? error : new Error(String(error)));
      if (getState().activeSessionId === sessionId) setError('Failed to load older messages.');
    } finally {
      setLoadingOlderMessages(false);
    }
  }, [historyMeta, loadingOlderMessages, sessionId, setError]);

  return { handleLoadOlderMessages, loadingOlderMessages };
}
