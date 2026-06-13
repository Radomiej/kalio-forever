import type { ChatMessage } from '@kalio/types';
import type { CliChildSocketDeps } from './useChatSocketEvents.cliChild';
import {
  identifyCliChildProjections,
  identifyCliChildrenOnReconnect,
  rebuildCliChildProjectionsFromHistory,
} from './useChatSocketEvents.cliChild';
import { buildTurnsFromHistory } from '../chatUtils';
import { reloadSessionHistoryWithArchitectureProjection } from '../architectureReloadHydration';

export interface SocketReconnectDeps {
  cliChild: CliChildSocketDeps;
  setStreaming: (value: boolean) => void;
  clearToolArgProgressTracking: (sessionId?: string | null) => void;
  clearToolActivities: (sessionId?: string) => void;
  removeActiveAgentLoop: (sessionId: string) => void;
  setPendingConfirmation: (sessionId: string, value: null) => void;
  getActiveSessionId: () => string | null;
  getSessionMessages: (sessionId: string) => ChatMessage[];
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
  setAgentTurns: (turns: ReturnType<typeof buildTurnsFromHistory>, sessionId?: string | null) => void;
  hasActiveLoopForSession: (sessionId: string) => boolean;
  fetchMessages: (sessionId: string) => Promise<ChatMessage[]>;
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
  identifyCliChildrenOnReconnect(deps.cliChild, sid);

  void reloadSessionHistoryWithArchitectureProjection({
    sessionId: sid,
    getActiveSessionId: deps.getActiveSessionId,
    getSessionMessages: deps.getSessionMessages,
    setMessages: deps.setMessages,
    setAgentTurns: deps.setAgentTurns,
    fetchMessages: deps.fetchMessages,
  })
    .then((hydratedMessages) => {
      if (!hydratedMessages) return;
      const projections = rebuildCliChildProjectionsFromHistory(deps.cliChild, sid, hydratedMessages);
      identifyCliChildProjections(deps.cliChild, projections, sid);
      if (!deps.hasActiveLoopForSession(sid)) {
        deps.setAgentTurns(buildTurnsFromHistory(hydratedMessages, sid), sid);
      }
      deps.onContextInvalidated?.();
    })
    .catch((err: unknown) => {
      console.error('[ChatInterface] reconnect history reload failed', err instanceof Error ? err : new Error(String(err)));
    });
}
