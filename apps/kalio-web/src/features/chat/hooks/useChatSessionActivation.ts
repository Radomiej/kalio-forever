import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { ChatMessage } from '@kalio/types';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { apiClient } from '../../../services/apiClient';
import { eventBus } from '../../../services/eventBus';
import { buildCallIdToNameFromMessages, buildTurnsFromHistory } from '../chatUtils';
import { reloadSessionHistoryWithArchitectureProjection } from '../architectureReloadHydration';
import { rebuildCLIChildProjectionsFromMessages } from '../cliChildProjection.model';
import { hasWorkflowEnvelopeHistory } from '../workflowEnvelopeRecovery';

interface UseChatSessionActivationParams {
  activeSessionId: string | null;
  clearToolActivities: (sessionId?: string) => void;
  handleSendRef: MutableRefObject<(content: string, personaId: string) => void>;
  setAgentTurns: (turns: ReturnType<typeof buildTurnsFromHistory>, sessionId?: string | null) => void;
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
  setPendingConfirmation: (sessionId: string, req: null) => void;
  updateAgentTurn: (turnId: string, patch: Partial<{ promptMessageId: string }>, sessionId?: string | null) => void;
}

export function useChatSessionActivation({
  activeSessionId,
  clearToolActivities,
  handleSendRef,
  setAgentTurns,
  setMessages,
  setPendingConfirmation,
  updateAgentTurn,
}: UseChatSessionActivationParams) {
  useEffect(() => {
    if (!activeSessionId) return;

    clearToolActivities(activeSessionId);
    setPendingConfirmation(activeSessionId, null);
    console.debug('[ChatInterface] session activated', activeSessionId);

    void reloadSessionHistoryWithArchitectureProjection({
      sessionId: activeSessionId,
      getActiveSessionId: () => useSessionStore.getState().activeSessionId,
      getSessionMessages: (sessionId) => useSessionStore.getState().getSessionMessages(sessionId),
      setMessages,
      setAgentTurns,
      fetchMessages: async (sessionId) => {
        const response = await apiClient.get<ChatMessage[]>(`/api/sessions/${sessionId}/messages`);
        return response.data;
      },
    })
      .then((hydratedMessages) => {
        if (!hydratedMessages) return;
        const {
          callIdToName: persistedCallIdToName,
          registerCallId,
          rebuildCLIChildProjections,
        } = useAgentStore.getState();
        const callIdToName = buildCallIdToNameFromMessages(hydratedMessages, persistedCallIdToName);
        for (const [callId, name] of Object.entries(callIdToName)) {
          if (!persistedCallIdToName[callId]) {
            registerCallId(callId, name);
          }
        }
        const projections = rebuildCLIChildProjectionsFromMessages(activeSessionId, hydratedMessages, callIdToName);
        rebuildCLIChildProjections(
          activeSessionId,
          projections,
        );
        const knownSessionIds = new Set(useSessionStore.getState().sessions.map((session) => session.id));
        projections.forEach((projection) => {
          if (!knownSessionIds.has(projection.childSessionId) && projection.childSessionId !== activeSessionId) {
            eventBus.identifySession(projection.childSessionId);
          }
        });
        const hasActiveLoop = useAgentStore.getState().hasActiveLoopForSession(activeSessionId);
        const hasActiveTurn = Boolean(useSessionStore.getState().getSessionActiveTurnId(activeSessionId));
        if (hasWorkflowEnvelopeHistory(hydratedMessages) || !hasActiveLoop || !hasActiveTurn) {
          setAgentTurns(buildTurnsFromHistory(hydratedMessages, activeSessionId), activeSessionId);
          return;
        }

        const latestUserMessageId = [...hydratedMessages]
          .reverse()
          .find((message) => message.role === 'user')
          ?.id;
        if (!latestUserMessageId) {
          return;
        }
        const activeTurnId = useSessionStore.getState().getSessionActiveTurnId(activeSessionId);
        const activeTurn = activeTurnId
          ? useSessionStore.getState().getSessionAgentTurns(activeSessionId).find((turn) => turn.id === activeTurnId)
          : null;
        if (activeTurn && !activeTurn.promptMessageId) {
          const persistedPromptMessageId = hydratedMessages.find((message) =>
            message.role === 'assistant'
            && message.turnId === activeTurn.id
            && message.promptMessageId,
          )?.promptMessageId;
          // TODO: legacy fallback - active recovered turns created before durable linkage still need latest-user backfill.
          updateAgentTurn(
            activeTurn.id,
            { promptMessageId: persistedPromptMessageId ?? latestUserMessageId },
            activeSessionId,
          );
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
  }, [activeSessionId, clearToolActivities, handleSendRef, setAgentTurns, setMessages, setPendingConfirmation, updateAgentTurn]);
}
