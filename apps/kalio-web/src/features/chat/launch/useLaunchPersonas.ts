import { useEffect, useState } from 'react';
import type { Persona } from '@kalio/types';
import { apiClient } from '../../../services/apiClient';

export function useLaunchPersonas(activePersonaId: string | null | undefined) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState(activePersonaId ?? 'default');

  useEffect(() => {
    apiClient
      .get<Persona[]>('/api/personas')
      .then((response) => setPersonas(response.data))
      .catch((err: unknown) => console.error('[LaunchScreen] personas load failed', err));
  }, []);

  useEffect(() => {
    setSelectedPersonaId(activePersonaId ?? 'default');
  }, [activePersonaId]);

  return {
    personas,
    selectedPersonaId,
    setSelectedPersonaId,
  };
}
