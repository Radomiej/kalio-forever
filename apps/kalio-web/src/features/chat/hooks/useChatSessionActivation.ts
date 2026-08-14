import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { ArchitectureExecutionEvent, ChatMessage, ChatSession } from '@kalio/types';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { backendHealth } from '../../../services/backendHealth';
import { apiClient } from '../../../services/apiClient';
import { identifyWatchedSession } from '../../../services/sessionWatchRegistry';
import { buildCallIdToNameFromMessages, buildTurnsFromHistory } from '../chatUtils';
import { rebuildCLIChildProjectionsFromMessages } from '../cliChildProjection.model';
import { hydrateActiveConversationSession } from '../activeConversationSession';
import { isPendingHostSession, isPendingHostSessionId } from '../pendingHostSession';
import {
  materializeLiveTurnFromHydratedRuntimeState,
} from './useChatSocketEvents.helpers';
import { budgetApprovalsFromArchitectureEvents } from '../architectureBudgetApprovalProjection';

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

async function hydrateArchitectureBudgetApprovalsFromEvents(session: ChatSession): Promise<void> {
  const architectureContext = session.runtimeContext?.architectureContext;
  const runId = typeof architectureContext?.architectureRunId === 'string' ? architectureContext.architectureRunId : null;
  if (!runId) {
    return;
  }

  const { data: events } = await apiClient.get<ArchitectureExecutionEvent[]>(`/api/architecture-runs/${runId}/events`);
  for (const request of budgetApprovalsFromArchitectureEvents(events, session.id)) {
    useAgentStore.getState().setPendingBudgetApproval(session.id, request);
  }
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
  const activeArchitectureRunId = useSessionStore((state) => {
    if (!activeSessionId) {
      return null;
    }
    const session = state.sessions.find((item) => item.id === activeSessionId);
    const runId = session?.runtimeContext?.architectureContext?.architectureRunId;
    return typeof runId === 'string' && runId.length > 0 ? runId : null;
  });

  useEffect(() => {
    if (!activeSessionId) return;
    const activeSession = useSessionStore.getState().sessions.find((session) => session.id === activeSessionId);
    if (isPendingHostSession(activeSession) || isPendingHostSessionId(activeSessionId)) return;

    identifyWatchedSession(activeSessionId, 'session-activation-active', { sticky: true, force: true });
    if (activeSession?.parentSessionId) {
      identifyWatchedSession(activeSession.parentSessionId, 'session-activation-parent', { sticky: true });
    }
    if (activeSession) {
      void hydrateArchitectureBudgetApprovalsFromEvents(activeSession).catch((error: unknown) => {
        console.warn('[ChatInterface] failed to hydrate architecture budget approvals', error instanceof Error ? error : new Error(String(error)));
      });
    }

    const runtimeSnapshot = useAgentStore.getState().getRuntimeActivitySnapshot(activeSessionId);
    const hasRestoredPendingTool = (runtimeSnapshot?.pendingConfirmations ?? []).length > 0
      || (runtimeSnapshot?.toolActivities ?? []).some((activity) =>
        activity.status === 'pending_confirmation' || activity.status === 'running',
      );
    if (!hasRestoredPendingTool) {
      clearToolActivities(activeSessionId);
    }
    if ((runtimeSnapshot?.pendingConfirmations ?? []).length === 0) {
      setPendingConfirmation(activeSessionId, null);
    }
    console.debug('[ChatInterface] session activated', activeSessionId);

    void hydrateActiveConversationSession({
      mode: 'select',
      sessionId: activeSessionId,
      getActiveSessionId: () => useSessionStore.getState().activeSessionId,
      getSessions: () => useSessionStore.getState().sessions,
      getSessionMessages: (sessionId) => useSessionStore.getState().getSessionMessages(sessionId),
      setMessages,
      setSessionHistoryMeta: (sessionId, meta) => useSessionStore.getState().setSessionHistoryMeta(sessionId, meta),
      setAgentTurns,
      getSessionAgentTurns: (sessionId) => useSessionStore.getState().getSessionAgentTurns(sessionId),
      getSessionActiveTurnId: (sessionId) => useSessionStore.getState().getSessionActiveTurnId(sessionId),
      hasActiveLoopForSession: (sessionId) => useAgentStore.getState().hasActiveLoopForSession(sessionId),
    })
      .then((hydratedMessages) => {
        backendHealth.reportSuccess();
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
        const sessionState = useSessionStore.getState();
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
            startAgentTurn: (turnId, sessionId) => sessionState.startAgentTurn(turnId, sessionId),
            setStreaming: (value, messageId, sessionId) => useAgentStore.getState().setStreaming(value, messageId, sessionId),
          },
        );
      })
      .catch((err: unknown) => {
        backendHealth.reportFailure();
        console.error('[ChatInterface] failed to load message history', err instanceof Error ? err : new Error(String(err)));
      });
  }, [activeArchitectureRunId, activeSessionId, clearToolActivities, setAgentTurns, setMessages, setPendingConfirmation, updateAgentTurn]);

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
