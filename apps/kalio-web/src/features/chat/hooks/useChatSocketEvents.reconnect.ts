import type { ChatMessage, ChatSession } from '@kalio/types';
import type { CliChildSocketDeps } from './useChatSocketEvents.cliChild';
import {
  identifyCliChildProjections,
  identifyCliChildrenOnReconnect,
  rebuildCliChildProjectionsFromHistory,
} from './useChatSocketEvents.cliChild';
import { buildTurnsFromHistory } from '../chatUtils';
import { reloadSessionHistoryWithArchitectureProjection } from '../architectureReloadHydration';
import { hasWorkflowEnvelopeHistory } from '../workflowEnvelopeRecovery';
import { normalizeConversationSessionId } from '../../sessions/sessionTreeDisplay';

export interface SocketReconnectDeps {
  cliChild: CliChildSocketDeps;
  setStreaming: (value: boolean) => void;
  clearToolArgProgressTracking: (sessionId?: string | null) => void;
  clearToolActivities: (sessionId?: string) => void;
  removeActiveAgentLoop: (sessionId: string) => void;
  setPendingConfirmation: (sessionId: string, value: null) => void;
  setActiveSession?: (sessionId: string) => void;
  setSessions?: (sessions: ChatSession[]) => void;
  getActiveSessionId: () => string | null;
  getSessionMessages: (sessionId: string) => ChatMessage[];
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
  setAgentTurns: (turns: ReturnType<typeof buildTurnsFromHistory>, sessionId?: string | null) => void;
  hasActiveLoopForSession: (sessionId: string) => boolean;
  fetchMessages: (sessionId: string) => Promise<ChatMessage[]>;
  fetchSessions?: () => Promise<ChatSession[]>;
  onContextInvalidated?: () => void;
}

export function handleSocketReconnect(deps: SocketReconnectDeps): void {
  deps.setStreaming(false);
  deps.clearToolArgProgressTracking();

  const sid = deps.getActiveSessionId();
  if (!sid) {
    deps.clearToolActivities();
    return;
  }

  deps.clearToolActivities(sid);
  deps.removeActiveAgentLoop(sid);
  deps.setPendingConfirmation(sid, null);

  void (async () => {
    let refreshedSessions: ChatSession[] | null = null;
    if (deps.fetchSessions && deps.setSessions) {
      try {
        refreshedSessions = await deps.fetchSessions();
        deps.setSessions(refreshedSessions);
      } catch (err) {
        console.error(
          '[ChatInterface] reconnect session refresh failed',
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }

    const currentSelection = deps.getActiveSessionId() ?? sid;
    const reconnectedSessionId = refreshedSessions
      ? normalizeConversationSessionId(currentSelection, refreshedSessions) ?? currentSelection
      : currentSelection;

    identifyCliChildrenOnReconnect(deps.cliChild, reconnectedSessionId);

    if (reconnectedSessionId !== currentSelection) {
      deps.setActiveSession?.(reconnectedSessionId);
    }
    if (reconnectedSessionId !== sid) {
      deps.clearToolActivities(reconnectedSessionId);
      deps.removeActiveAgentLoop(reconnectedSessionId);
      deps.setPendingConfirmation(reconnectedSessionId, null);
    }

    const hydratedMessages = await reloadSessionHistoryWithArchitectureProjection({
      sessionId: reconnectedSessionId,
      getActiveSessionId: () => {
        const activeSessionId = deps.getActiveSessionId();
        if (!activeSessionId || !refreshedSessions) {
          return activeSessionId;
        }
        return normalizeConversationSessionId(activeSessionId, refreshedSessions) ?? activeSessionId;
      },
      getSessionMessages: deps.getSessionMessages,
      setMessages: deps.setMessages,
      setAgentTurns: deps.setAgentTurns,
      fetchMessages: deps.fetchMessages,
    });
    if (!hydratedMessages) return;
    const projections = rebuildCliChildProjectionsFromHistory(deps.cliChild, reconnectedSessionId, hydratedMessages);
    identifyCliChildProjections(deps.cliChild, projections, reconnectedSessionId);
    if (hasWorkflowEnvelopeHistory(hydratedMessages) || !deps.hasActiveLoopForSession(reconnectedSessionId)) {
      deps.setAgentTurns(buildTurnsFromHistory(hydratedMessages, reconnectedSessionId), reconnectedSessionId);
    }
    deps.onContextInvalidated?.();
  })()
    .catch((err: unknown) => {
      console.error('[ChatInterface] reconnect history reload failed', err instanceof Error ? err : new Error(String(err)));
    });
}
