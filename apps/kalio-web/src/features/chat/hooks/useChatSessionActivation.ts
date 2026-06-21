import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { ChatMessage } from '@kalio/types';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { identifyWatchedSession } from '../../../services/sessionWatchRegistry';
import { buildCallIdToNameFromMessages, buildTurnsFromHistory } from '../chatUtils';
import { rebuildCLIChildProjectionsFromMessages } from '../cliChildProjection.model';
import { hydrateActiveConversationSession } from '../activeConversationSession';
import {
  materializeLiveTurnFromHydratedRuntimeState,
} from './useChatSocketEvents.helpers';

interface UseChatSessionActivationParams {
  activeSessionId: string | null;
  clearToolActivities: (sessionId?: string) => void;
  handleSendRef: MutableRefObject<(content: string, personaId: string) => void>;
  setAgentTurns: (turns: ReturnType<typeof buildTurnsFromHistory>, sessionId?: string | null) => void;
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
  setPendingConfirmation: (sessionId: string, req: null) => void;
  updateAgentTurn: (turnId: string, patch: Partial<{ promptMessageId: string }>, sessionId?: string | null) => void;
}

function buildDeterministicRaAppLaunchPrompt(launchIntent: {
  appId: string;
  prompt: string;
}): string {
  const basePrompt = launchIntent.prompt.trim();
  const exactRunInstruction =
    `Use run_raapp with the exact id "${launchIntent.appId}" now. ` +
    'Do not choose a different RA-App id unless this exact id is missing.';

  return basePrompt.length > 0
    ? `${basePrompt}\n\n${exactRunInstruction}`
    : exactRunInstruction;
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
  const pendingMessage = useSessionStore((state) => state.pendingMessage);
  const pendingRAAppLaunchIntent = useSessionStore((state) => state.pendingRAAppLaunchIntent);

  useEffect(() => {
    if (!activeSessionId) return;

    clearToolActivities(activeSessionId);
    setPendingConfirmation(activeSessionId, null);
    console.debug('[ChatInterface] session activated', activeSessionId);

    void hydrateActiveConversationSession({
      mode: 'select',
      sessionId: activeSessionId,
      getActiveSessionId: () => useSessionStore.getState().activeSessionId,
      getSessions: () => useSessionStore.getState().sessions,
      getSessionMessages: (sessionId) => useSessionStore.getState().getSessionMessages(sessionId),
      setMessages,
      setAgentTurns,
      getSessionAgentTurns: (sessionId) => useSessionStore.getState().getSessionAgentTurns(sessionId),
      getSessionActiveTurnId: (sessionId) => useSessionStore.getState().getSessionActiveTurnId(sessionId),
      hasActiveLoopForSession: (sessionId) => useAgentStore.getState().hasActiveLoopForSession(sessionId),
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
            identifyWatchedSession(projection.childSessionId, 'session-activation-child', { sticky: true });
          }
        });
        const currentTurns = useSessionStore.getState().getSessionAgentTurns(activeSessionId);
        const activeTurnId = useSessionStore.getState().getSessionActiveTurnId(activeSessionId);
        const latestUserMessageId = [...hydratedMessages]
          .reverse()
          .find((message) => message.role === 'user')
          ?.id;
        if (!latestUserMessageId) {
          return;
        }
        const activeTurn = activeTurnId
          ? currentTurns.find((turn) => turn.id === activeTurnId)
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
        const agentState = useAgentStore.getState();
        materializeLiveTurnFromHydratedRuntimeState(
          {
            runtimeSnapshot: agentState.getRuntimeActivitySnapshot(activeSessionId),
            bufferedSessionStatusSnapshots: agentState.consumeBufferedSessionStatusSnapshots(activeSessionId),
            latestSessionStatusSnapshot: agentState.sessionStatusSnapshots[activeSessionId],
          },
          {
            hasActiveLoopForSession: (sessionId) => useAgentStore.getState().hasActiveLoopForSession(sessionId),
            getSessionActiveTurnId: (sessionId) => useSessionStore.getState().getSessionActiveTurnId(sessionId),
            addActiveAgentLoop: (sessionId, turnId) => useAgentStore.getState().addActiveAgentLoop(sessionId, turnId),
            startAgentTurn: (turnId, sessionId) => useSessionStore.getState().startAgentTurn(turnId, sessionId),
          },
        );
      })
      .catch((err: unknown) => {
        console.error('[ChatInterface] failed to load message history', err instanceof Error ? err : new Error(String(err)));
      });
  }, [activeSessionId, clearToolActivities, setAgentTurns, setMessages, setPendingConfirmation, updateAgentTurn]);

  useEffect(() => {
    if (!activeSessionId) return;

    const {
      setPendingMessage,
      setPendingRAAppLaunchIntent,
      sessions,
    } = useSessionStore.getState();
    const launchIntent = pendingRAAppLaunchIntent?.targetSessionId === activeSessionId
      ? pendingRAAppLaunchIntent
      : null;
    const toSend = launchIntent
      ? buildDeterministicRaAppLaunchPrompt(launchIntent)
      : pendingMessage;
    if (!toSend) return;

    setPendingMessage(null);
    setPendingRAAppLaunchIntent(null);
    const pendingSession = sessions.find((session) => session.id === activeSessionId);
    handleSendRef.current(toSend, launchIntent?.personaId ?? pendingSession?.personaId ?? 'default');
  }, [activeSessionId, handleSendRef, pendingMessage, pendingRAAppLaunchIntent]);
}
