import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@kalio/types';
import { useSessionStore } from '../../store/sessionStore';
import { hasVisibleBranchTranscript } from './CanvasPanel.Focus';
import { mergeFetchedMessages } from './chatUtils';
import { DEFAULT_CHILD_SESSION_HISTORY_LIMIT, fetchSessionHistoryWindow, type SessionHistoryWindow } from './sessionHistoryApi';

const FOCUSED_BRANCH_RETRY_DELAY_MS = 1_000;

interface ChildTranscriptHydrationOptions {
  activeSessionId: string | null;
  childPreviewSessionIds: string[];
  focusedCanvasSessionId: string | undefined;
  getSessionMessages: (sessionId: string | null) => ChatMessage[];
  sessionMessages: Record<string, ChatMessage[]>;
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
}

export async function hydrateChildSessionTranscript({
  sessionId,
  getSessionMessages,
  setMessages,
}: {
  sessionId: string;
  getSessionMessages: (sessionId: string | null) => ChatMessage[];
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
}): Promise<SessionHistoryWindow> {
  const loadedWindow = await fetchSessionHistoryWindow(sessionId, { limit: DEFAULT_CHILD_SESSION_HISTORY_LIMIT });
  const currentMessages = getSessionMessages(sessionId);
  useSessionStore.getState().setSessionHistoryMeta(sessionId, loadedWindow.meta);
  setMessages(mergeFetchedMessages(currentMessages, loadedWindow.messages), sessionId);
  return loadedWindow;
}

export function useHydrateChildSessionTranscripts({
  activeSessionId,
  childPreviewSessionIds,
  focusedCanvasSessionId,
  getSessionMessages,
  sessionMessages,
  setMessages,
}: ChildTranscriptHydrationOptions): ChatMessage[] | null {
  const [hydratedSubagentSessions, setHydratedSubagentSessions] = useState<Record<string, true>>({});
  const [focusedTranscriptOverride, setFocusedTranscriptOverride] = useState<ChatMessage[] | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const inFlightSessionIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setFocusedTranscriptOverride(null);
  }, [focusedCanvasSessionId]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const candidateSessionIds = new Set([
      ...childPreviewSessionIds,
      ...(focusedCanvasSessionId ? [focusedCanvasSessionId] : []),
    ]);
    const isMissingSession = (sessionId: string): boolean => (
      sessionId !== activeSessionId
      && !hasVisibleBranchTranscript(sessionMessages[sessionId])
      && (!hydratedSubagentSessions[sessionId] || sessionId === focusedCanvasSessionId)
      && !inFlightSessionIdsRef.current.has(sessionId)
    );
    const focusedSessionNeedsHydration = focusedCanvasSessionId ? isMissingSession(focusedCanvasSessionId) : false;
    const missingSessionIds = (focusedSessionNeedsHydration && focusedCanvasSessionId
      ? [focusedCanvasSessionId]
      : Array.from(candidateSessionIds)
      .filter((sessionId) => sessionId !== activeSessionId)
      .filter((sessionId) => !hasVisibleBranchTranscript(sessionMessages[sessionId]))
      .filter((sessionId) => !hydratedSubagentSessions[sessionId] || sessionId === focusedCanvasSessionId)
      .filter((sessionId) => !inFlightSessionIdsRef.current.has(sessionId)));

    if (missingSessionIds.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    missingSessionIds.forEach((sessionId) => {
      inFlightSessionIdsRef.current.add(sessionId);
    });
    const clearInFlight = () => {
      missingSessionIds.forEach((sessionId) => {
        inFlightSessionIdsRef.current.delete(sessionId);
      });
    };

    void Promise.all(
      missingSessionIds.map(async (sessionId) => {
        const response = await hydrateChildSessionTranscript({ sessionId, getSessionMessages, setMessages });
        return [sessionId, response] as const;
      }),
    )
      .then((results) => {
        clearInFlight();
        if (cancelled) return;
        let focusedBranchStillMissing = false;
        results.forEach(([sessionId, loadedWindow]) => {
          if (sessionId === focusedCanvasSessionId && !hasVisibleBranchTranscript(loadedWindow.messages)) {
            focusedBranchStillMissing = true;
          }
          if (sessionId === focusedCanvasSessionId && hasVisibleBranchTranscript(loadedWindow.messages)) {
            setFocusedTranscriptOverride(loadedWindow.messages);
          }
        });
        setHydratedSubagentSessions((current) => {
          let changed = false;
          const next = { ...current };
          results.forEach(([sessionId, loadedWindow]) => {
            if (!hasVisibleBranchTranscript(loadedWindow.messages)) {
              if (next[sessionId]) {
                delete next[sessionId];
                changed = true;
              }
              return;
            }
            if (!next[sessionId]) {
              next[sessionId] = true;
              changed = true;
            }
          });
          return changed ? next : current;
        });
        if (focusedBranchStillMissing) {
          retryTimer = setTimeout(() => setRetryTick((current) => current + 1), FOCUSED_BRANCH_RETRY_DELAY_MS);
        }
      })
      .catch((err: unknown) => {
        clearInFlight();
        console.error('[CanvasPanel] failed to load subagent transcript', err instanceof Error ? err : new Error(String(err)));
        if (focusedCanvasSessionId && !cancelled) {
          retryTimer = setTimeout(() => setRetryTick((current) => current + 1), FOCUSED_BRANCH_RETRY_DELAY_MS);
        }
      });

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [
    activeSessionId,
    childPreviewSessionIds,
    focusedCanvasSessionId,
    getSessionMessages,
    hydratedSubagentSessions,
    retryTick,
    sessionMessages,
    setMessages,
  ]);

  return focusedTranscriptOverride;
}
