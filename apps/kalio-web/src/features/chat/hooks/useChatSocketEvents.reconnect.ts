import type { ChatMessage } from '@kalio/types';
import type { CliChildSocketDeps } from './useChatSocketEvents.cliChild';
import { identifyCliChildrenOnReconnect, rebuildCliChildProjectionsFromHistory } from './useChatSocketEvents.cliChild';
import { buildTurnsFromHistory, mergeFetchedMessages } from '../chatUtils';

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

  deps.fetchMessages(sid)
    .then((data) => {
      if (deps.getActiveSessionId() !== sid) return;
      const currentMessages = deps.getSessionMessages(sid);
      const mergedMessages = mergeFetchedMessages(currentMessages, data);
      deps.setMessages(mergedMessages, sid);
      rebuildCliChildProjectionsFromHistory(deps.cliChild, sid, mergedMessages);
      if (!deps.hasActiveLoopForSession(sid)) {
        deps.setAgentTurns(buildTurnsFromHistory(mergedMessages, sid), sid);
      }
      deps.onContextInvalidated?.();
    })
    .catch((err: unknown) => {
      console.error('[ChatInterface] reconnect history reload failed', err instanceof Error ? err : new Error(String(err)));
    });
}
