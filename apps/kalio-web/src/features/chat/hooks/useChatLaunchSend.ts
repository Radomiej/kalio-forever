import { useEffect, useRef } from 'react';
import type { ChatSession } from '@kalio/types';
import { useSessionStore } from '../../../store/sessionStore';
import { activateConversationSession } from '../activeConversationSession';
import { persistSessionLaunchSelection } from '../launch/launchContext';
import { createAndActivateHostSession } from '../launch/sessionLaunchShared';

export function useChatLaunchSend({ activeSession, projectId, projectPath, send, onError }: {
  activeSession: ChatSession | null;
  projectId: string;
  projectPath: string;
  send: (content: string, personaId: string) => void;
  onError: (error: string | null) => void;
}) {
  const pending = useRef(false);
  const createdSession = useRef<{ session: ChatSession; projectId: string; projectPath: string } | null>(null);
  useEffect(() => {
    if (activeSession) createdSession.current = null;
  }, [activeSession?.id]);
  return async (content: string, personaId: string, executionProfileId?: string) => {
    if (pending.current || !content.trim()) return;
    pending.current = true;
    try {
      if (!executionProfileId) throw new Error('Choose a connected provider and model before starting this chat.');
      const store = useSessionStore.getState();
      const cached = createdSession.current;
      let session = activeSession ?? (cached?.projectId === projectId && cached.projectPath === projectPath ? cached.session : null);
      if (!session) {
        session = await createAndActivateHostSession({
          personaId, projectId, projectPathOverride: projectPath || null,
          addSession: store.addSession, setMessages: store.setMessages, setAgentTurns: store.setAgentTurns,
          // Keep the draft mounted until the provider selection has been saved.
          setActiveSession: () => undefined,
        });
        createdSession.current = { session, projectId, projectPath };
      }
      session = await persistSessionLaunchSelection(session, personaId, executionProfileId, store.updateSession);
      if (!activeSession) {
        await activateConversationSession({ sessionId: session.id, sessions: [session], setActiveSession: store.setActiveSession, reason: 'landing' });
      }
      onError(null);
      send(content, personaId);
    } catch (error: unknown) {
      console.error('[ChatInterface] launch failed', error);
      onError(error instanceof Error ? error.message : 'Failed to start this chat.');
    } finally {
      pending.current = false;
    }
  };
}
