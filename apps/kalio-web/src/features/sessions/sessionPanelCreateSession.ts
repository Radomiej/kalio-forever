import type { ChatMessage, ChatSession } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';
import { persistActiveConversationSessionId } from '../chat/activeConversationSession';

interface StartPendingSessionFromPanelParams {
  personaId: string;
  previousActiveSessionId: string | null;
  addSession: (session: ChatSession) => void;
  setActiveSession: (sessionId: string | null) => void;
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
  setAgentTurns: (turns: AgentTurn[], sessionId?: string | null) => void;
  removeSession: (sessionId: string) => void;
  getActiveSessionId: () => string | null;
  onSelect?: () => void;
}

export async function startPendingSessionFromPanel({
  setActiveSession,
  setMessages,
  setAgentTurns,
  onSelect,
}: StartPendingSessionFromPanelParams): Promise<void> {
  // A new conversation has no durable identity until its first submit.
  setActiveSession(null);
  setMessages([]);
  setAgentTurns([]);
  persistActiveConversationSessionId(null);
  onSelect?.();
}
