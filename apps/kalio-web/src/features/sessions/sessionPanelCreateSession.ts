import type { ChatMessage, ChatSession } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';
import { createAndActivateEmptyHostSession } from '../chat/activeConversationSession';
import { createPendingHostSession } from '../chat/pendingHostSession';

interface StartPendingSessionFromPanelParams {
  personaId: string;
  previousActiveSessionId: string | null;
  addSession: (session: ChatSession) => void;
  setActiveSession: (sessionId: string | null) => void;
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
  setAgentTurns: (turns: AgentTurn[], sessionId?: string | null) => void;
  removeSession: (sessionId: string) => void;
  onSelect?: () => void;
}

export async function startPendingSessionFromPanel({
  personaId,
  previousActiveSessionId,
  addSession,
  setActiveSession,
  setMessages,
  setAgentTurns,
  removeSession,
  onSelect,
}: StartPendingSessionFromPanelParams): Promise<void> {
  const pendingSession = createPendingHostSession({ personaId, title: 'New Chat' });
  addSession(pendingSession);
  setActiveSession(pendingSession.id);
  setMessages([], pendingSession.id);
  setAgentTurns([], pendingSession.id);
  onSelect?.();

  try {
    await createAndActivateEmptyHostSession({
      personaId,
      title: 'New Chat',
      addSession,
      setActiveSession,
      setMessages,
      setAgentTurns,
      reason: 'select',
    });
    removeSession(pendingSession.id);
  } catch (err) {
    removeSession(pendingSession.id);
    setActiveSession(previousActiveSessionId);
    throw err;
  }
}
