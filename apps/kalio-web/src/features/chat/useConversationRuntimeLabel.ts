import type { ChatSession, Persona } from '@kalio/types';
import { useRuntimeProfileLabel } from './useRuntimeProfileLabel';

export function resolveConversationProfileId(
  hasMessages: boolean,
  selectedProfileId: string,
  sessionProfileId?: string,
  personaProfileId?: string,
): string | undefined {
  return hasMessages ? sessionProfileId ?? personaProfileId : selectedProfileId || undefined;
}

export function useConversationRuntimeLabel(
  session: ChatSession | null,
  personas: Persona[],
  hasMessages: boolean,
  selectedProfileId: string,
  provider?: string,
  backendModel?: string,
) {
  const persona = personas.find((candidate) => candidate.id === session?.personaId);
  return useRuntimeProfileLabel({
    executionProfileId: resolveConversationProfileId(hasMessages, selectedProfileId, session?.executionProfileId, persona?.executionProfileId),
    provider,
    personaModel: hasMessages ? persona?.model : undefined,
    backendModel,
  });
}
