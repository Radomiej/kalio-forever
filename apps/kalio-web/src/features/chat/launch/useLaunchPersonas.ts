import { useEffect, useState } from 'react';
import type { ExecutionProfile, Persona } from '@kalio/types';
import { apiClient, getExecutionProfiles } from '../../../services/apiClient';

export function useLaunchPersonas(
  activePersonaId: string | null | undefined,
  activeExecutionProfileId?: string | null,
) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [executionProfiles, setExecutionProfiles] = useState<ExecutionProfile[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState(activePersonaId ?? 'default');
  const [selectedExecutionProfileId, setSelectedExecutionProfileId] = useState(activeExecutionProfileId ?? '');

  useEffect(() => {
    apiClient
      .get<Persona[]>('/api/personas')
      .then((response) => setPersonas(response.data))
      .catch((err: unknown) => console.error('[LaunchScreen] personas load failed', err));
    getExecutionProfiles()
      .then((profiles) => setExecutionProfiles(profiles.filter(isUserSelectableProfile)))
      .catch((err: unknown) => console.error('[LaunchScreen] execution profiles load failed', err));
  }, []);

  useEffect(() => {
    setSelectedPersonaId(activePersonaId ?? 'default');
  }, [activePersonaId]);

  useEffect(() => {
    const personaProfileId = personas.find((persona) => persona.id === activePersonaId)?.executionProfileId;
    setSelectedExecutionProfileId(resolveLaunchExecutionProfileId(activeExecutionProfileId, personaProfileId, executionProfiles));
  }, [activeExecutionProfileId, activePersonaId, executionProfiles, personas]);

  const selectPersona = (personaId: string) => {
    setSelectedPersonaId(personaId);
    const recommendation = personas.find((persona) => persona.id === personaId)?.executionProfileId;
    if (recommendation && executionProfiles.some((profile) => profile.id === recommendation)) {
      setSelectedExecutionProfileId(recommendation);
    }
  };

  return {
    personas,
    executionProfiles,
    selectedPersonaId,
    selectPersona,
    setSelectedPersonaId,
    selectedExecutionProfileId,
    setSelectedExecutionProfileId,
  };
}

function isUserSelectableProfile(profile: ExecutionProfile): boolean {
  return profile.enabled
    && !(profile.kind === 'direct-llm' && profile.provider === 'mock')
    && profile.id !== 'local-direct-default'
    && !profile.name.toLowerCase().includes('mock');
}

export function resolveLaunchExecutionProfileId(
  sessionProfileId: string | null | undefined,
  personaRecommendationId: string | null | undefined,
  profiles: ExecutionProfile[],
): string {
  return profiles.find((profile) => profile.id === sessionProfileId)?.id
    ?? profiles.find((profile) => profile.id === personaRecommendationId)?.id
    ?? '';
}
