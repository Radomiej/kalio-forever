import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { ChatMessage } from '@kalio/types';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { buildTurnsFromHistory } from '../chatUtils';

interface UseChatSessionActivationParams {
  activeSessionId: string | null;
  clearToolActivities: (sessionId?: string) => void;
  handleSendRef: MutableRefObject<(content: string, personaId: string) => void>;
  setAgentTurns: (turns: ReturnType<typeof buildTurnsFromHistory>, sessionId?: string | null) => void;
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
  setPendingConfirmation: (sessionId: string, req: null) => void;
}

export function useChatSessionActivation({
  activeSessionId,
  clearToolActivities,
  handleSendRef,
  setAgentTurns,
  setMessages,
  setPendingConfirmation,
}: UseChatSessionActivationParams) {
  useEffect(() => {
    if (!activeSessionId) return;

    clearToolActivities(activeSessionId);
    setPendingConfirmation(activeSessionId, null);
    console.debug('[ChatInterface] session activated', activeSessionId);

    fetch(`/api/sessions/${activeSessionId}/messages`)
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((data: ChatMessage[]) => {
        if (useSessionStore.getState().activeSessionId !== activeSessionId) return;
        setMessages(data);
        if (!useAgentStore.getState().hasActiveLoopForSession(activeSessionId)) {
          setAgentTurns(buildTurnsFromHistory(data, activeSessionId));
        }
      })
      .catch((err: unknown) => {
        console.error('[ChatInterface] failed to load message history', err instanceof Error ? err : new Error(String(err)));
      });

    const {
      pendingMessage,
      pendingRAAppId,
      setPendingMessage,
      setPendingRAAppId,
      sessions,
    } = useSessionStore.getState();
    const toSend = pendingMessage
      ?? (pendingRAAppId ? `Use the ${sessions.find((session) => session.id === activeSessionId)?.title ?? pendingRAAppId} tool` : null);
    if (!toSend) return;

    setPendingMessage(null);
    setPendingRAAppId(null);
    const pendingSession = sessions.find((session) => session.id === activeSessionId);
    handleSendRef.current(toSend, pendingSession?.personaId ?? 'default');
  }, [activeSessionId, clearToolActivities, handleSendRef, setAgentTurns, setMessages, setPendingConfirmation]);
}