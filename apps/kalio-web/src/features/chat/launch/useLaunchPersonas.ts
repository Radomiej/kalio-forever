import { useEffect, useState } from 'react';
import type { ExecutionProfile, Persona } from '@kalio/types';
import { apiClient, getExecutionProfiles } from '../../../services/apiClient';
import { decisionSettingsRequest } from '../../settings/decision-settings.transport';

export function useLaunchPersonas(
  activePersonaId: string | null | undefined,
  activeExecutionProfileId?: string | null,
) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [executionProfiles, setExecutionProfiles] = useState<ExecutionProfile[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState(activePersonaId ?? 'default');
  const [selectedExecutionProfileId, setSelectedExecutionProfileId] = useState(activeExecutionProfileId ?? '');
  const [defaultExecutionProfileId, setDefaultExecutionProfileId] = useState<string | null>(null);

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
    let alive = true;
    decisionSettingsRequest('/api/runtime/default-profile')
      .then((response) => response.json() as Promise<{ executionProfileId: string | null }>)
      .then((response) => { if (alive) setDefaultExecutionProfileId(response.executionProfileId); })
      .catch((err: unknown) => console.error('[LaunchScreen] default runtime load failed', err));
    return () => { alive = false; };
  }, [activePersonaId, activeExecutionProfileId]);

  useEffect(() => {
    setSelectedPersonaId(activePersonaId ?? 'default');
  }, [activePersonaId]);

  useEffect(() => {
    const personaProfileId = personas.find((persona) => persona.id === activePersonaId)?.executionProfileId;
    setSelectedExecutionProfileId(resolveLaunchExecutionProfileId(activeExecutionProfileId, personaProfileId, executionProfiles, defaultExecutionProfileId));
  }, [activeExecutionProfileId, activePersonaId, executionProfiles, personas, defaultExecutionProfileId]);

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
  defaultProfileId?: string | null,
): string {
  return profiles.find((profile) => profile.id === sessionProfileId)?.id
    ?? profiles.find((profile) => profile.id === defaultProfileId)?.id
    ?? profiles.find((profile) => profile.id === personaRecommendationId)?.id
    ?? '';
}
