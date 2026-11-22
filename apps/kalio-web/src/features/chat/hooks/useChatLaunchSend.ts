import { useEffect, useRef } from 'react';
import type { ChatSession } from '@kalio/types';
import { useSessionStore } from '../../../store/sessionStore';
import { uploadComposerImages, type ComposerSendOptions } from '../composerImages';
import { activateConversationSession } from '../activeConversationSession';
import { persistSessionLaunchSelection } from '../launch/launchContext';
import { createAndActivateHostSession } from '../launch/sessionLaunchShared';

export function useChatLaunchSend({ activeSession, projectId, projectPath, selectedArchitectureId = 'single-chat', send, onError }: {
  activeSession: ChatSession | null;
  projectId: string;
  projectPath: string;
  selectedArchitectureId?: string;
  send: (content: string, personaId: string, options?: ComposerSendOptions) => boolean | void | Promise<boolean | void>;
  onError: (error: string | null) => void;
}) {
  const pending = useRef(false);
  const createdSession = useRef<{ session: ChatSession; projectId: string; projectPath: string; schemaId: string } | null>(null);
  useEffect(() => {
    if (activeSession) createdSession.current = null;
  }, [activeSession?.id]);
  return async (content: string, personaId: string, executionProfileId?: string, images?: File[]) => {
    if (pending.current || !content.trim()) return false;
    pending.current = true;
    try {
      if (images?.length && selectedArchitectureId !== 'single-chat') throw new Error('Image attachments are unavailable in this workflow.');
      if (!executionProfileId) throw new Error('Choose a connected provider and model before starting this chat.');
      const store = useSessionStore.getState();
      const cached = createdSession.current;
      let session = activeSession ?? (cached?.projectId === projectId && cached.projectPath === projectPath
        && cached.schemaId === selectedArchitectureId ? cached.session : null);
      if (!session) {
        session = await createAndActivateHostSession({
          personaId, projectId, projectPathOverride: projectPath || null,
          ...(selectedArchitectureId !== 'single-chat' ? {
            runtimeContext: { runtimeKind: 'chat' as const, architectureContext: { schemaId: selectedArchitectureId } },
          } : {}),
          addSession: store.addSession, setMessages: store.setMessages, setAgentTurns: store.setAgentTurns,
          // Keep the draft mounted until the provider selection has been saved.
          setActiveSession: () => undefined,
        });
        createdSession.current = { session, projectId, projectPath, schemaId: selectedArchitectureId };
      }
      session = await persistSessionLaunchSelection(session, personaId, executionProfileId, store.updateSession);
      const attachments = images?.length ? await uploadComposerImages(session.id, images) : undefined;
      if (!activeSession) {
        await activateConversationSession({ sessionId: session.id, sessions: [session], setActiveSession: store.setActiveSession, reason: 'landing' });
      }
      onError(null);
      if (attachments) return (await send(content, personaId, { attachments })) !== false;
      send(content, personaId);
      return true;
    } catch (error: unknown) {
      console.error('[ChatInterface] launch failed', error);
      onError(error instanceof Error ? error.message : 'Failed to start this chat.');
      return false;
    } finally {
      pending.current = false;
    }
  };
}
