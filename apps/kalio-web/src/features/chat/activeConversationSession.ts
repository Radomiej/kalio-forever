import type { ChatMessage, ChatSession } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';
import type { SessionHistoryFetchResult, SessionHistoryMeta, SessionHistoryWindow } from './sessionHistoryApi';
import { useSessionStore } from '../../store/sessionStore';
import { hydrateSessionHistoryIntoStore } from './historyHydration';
import { createAndActivateHostSession } from './launch/sessionLaunchShared';
import { isPendingHostSessionId } from './pendingHostSession';
import { normalizeConversationSessionId } from '../sessions/sessionTreeDisplay';
import { DEFAULT_SESSION_HISTORY_LIMIT, fetchSessionHistoryWindow } from './sessionHistoryApi';

export const LAST_ACTIVE_CONVERSATION_SESSION_STORAGE_KEY = 'kalio:last-active-session-id';

export type ConversationActivationReason =
  | 'select'
  | 'landing'
  | 'quick-chat'
  | 'graph'
  | 'canvas'
  | 'cli-child'
  | 'confirmation'
  | 'app-open';

export type ConversationHydrationMode = 'select' | 'reload' | 'reconnect';

export interface SharedConversationHydrationDeps {
  getActiveSessionId: () => string | null;
  getSessions: () => ChatSession[];
  getSessionMessages: (sessionId: string) => ChatMessage[];
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
  setSessionHistoryMeta?: (sessionId: string, meta: SessionHistoryMeta | null) => void;
  setAgentTurns: (turns: AgentTurn[], sessionId?: string | null) => void;
  getSessionAgentTurns: (sessionId: string) => AgentTurn[];
  getSessionActiveTurnId: (sessionId: string) => string | null;
  hasActiveLoopForSession: (sessionId: string) => boolean;
  fetchMessages?: (sessionId: string) => Promise<SessionHistoryFetchResult>;
}

interface ActivateConversationSessionParams {
  sessionId: string;
  sessions: readonly ChatSession[] | Map<string, ChatSession>;
  setActiveSession: (sessionId: string) => void;
  onActivated?: (sessionId: string, reason: ConversationActivationReason) => void | Promise<void>;
  reason: ConversationActivationReason;
}

interface CreateAndActivateEmptyHostSessionParams {
  personaId: string;
  title?: string;
  runtimeContext?: ChatSession['runtimeContext'];
  addSession: (session: ChatSession) => void;
  setActiveSession: (sessionId: string | null) => void;
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
  setAgentTurns: (turns: AgentTurn[], sessionId?: string | null) => void;
  onActivated?: (sessionId: string, reason: ConversationActivationReason) => void | Promise<void>;
  reason: ConversationActivationReason;
}

interface HydrateActiveConversationSessionParams extends SharedConversationHydrationDeps {
  mode: ConversationHydrationMode;
  sessionId: string;
}

export function loadStoredActiveConversationSessionId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.sessionStorage.getItem(LAST_ACTIVE_CONVERSATION_SESSION_STORAGE_KEY);
}

export function persistActiveConversationSessionId(sessionId: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (sessionId) {
    if (isPendingHostSessionId(sessionId)) {
      return;
    }
    window.sessionStorage.setItem(LAST_ACTIVE_CONVERSATION_SESSION_STORAGE_KEY, sessionId);
    return;
  }

  window.sessionStorage.removeItem(LAST_ACTIVE_CONVERSATION_SESSION_STORAGE_KEY);
}

export function normalizeConversationSessionSelection(
  sessionId: string,
  sessions: readonly ChatSession[] | Map<string, ChatSession>,
): string {
  return normalizeConversationSessionId(sessionId, sessions) ?? sessionId;
}

export async function hydrateActiveConversationSession({
  mode,
  sessionId,
  getActiveSessionId,
  getSessions,
  getSessionMessages,
  setMessages,
  setSessionHistoryMeta,
  setAgentTurns,
  getSessionAgentTurns,
  getSessionActiveTurnId,
  hasActiveLoopForSession,
  fetchMessages,
}: HydrateActiveConversationSessionParams): Promise<ChatMessage[] | null> {
  void mode;
  return hydrateSessionHistoryIntoStore({
    sessionId,
    getActiveSessionId,
    getSessions,
    getSessionMessages,
    setMessages,
    setSessionHistoryMeta,
    setAgentTurns,
    getSessionAgentTurns,
    getSessionActiveTurnId,
    hasActiveLoopForSession,
    fetchMessages: fetchMessages ?? fetchConversationSessionMessages,
  });
}

export async function activateConversationSession({
  sessionId,
  sessions,
  setActiveSession,
  onActivated,
  reason,
}: ActivateConversationSessionParams): Promise<string> {
  const targetSessionId = normalizeConversationSessionSelection(sessionId, sessions);
  setActiveSession(targetSessionId);
  persistActiveConversationSessionId(targetSessionId);
  await onActivated?.(targetSessionId, reason);
  return targetSessionId;
}

export async function createAndActivateEmptyHostSession({
  personaId,
  title,
  runtimeContext,
  addSession,
  setActiveSession,
  setMessages,
  setAgentTurns,
  onActivated,
  reason,
}: CreateAndActivateEmptyHostSessionParams): Promise<ChatSession> {
  const session = await createAndActivateHostSession({
    personaId,
    ...(title ? { title } : {}),
    ...(runtimeContext ? { runtimeContext } : {}),
    addSession,
    setActiveSession,
    setMessages,
    setAgentTurns,
  });
  persistActiveConversationSessionId(session.id);
  useSessionStore.getState().markSessionHydrated(session.id);
  await onActivated?.(session.id, reason);
  return session;
}

async function fetchConversationSessionMessages(sessionId: string): Promise<SessionHistoryWindow> {
  const window = await fetchSessionHistoryWindow(sessionId, { limit: DEFAULT_SESSION_HISTORY_LIMIT });
  useSessionStore.getState().setSessionHistoryMeta(sessionId, window.meta);
  return window;
}
