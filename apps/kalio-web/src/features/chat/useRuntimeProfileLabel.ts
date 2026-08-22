import { useEffect, useMemo, useState } from 'react';
import type { ExecutionProfile } from '@kalio/types';
import { getExecutionProfiles } from '../../services/apiClient';
import { resolveRuntimeProfileLabel, type RuntimeProfileLabel } from './runtimeProfileLabel';

export function useRuntimeProfileLabel(input: {
  executionProfileId?: string;
  provider?: string;
  personaModel?: string;
  backendModel?: string;
}): RuntimeProfileLabel {
  const [profiles, setProfiles] = useState<ExecutionProfile[]>([]);

  useEffect(() => {
    let cancelled = false;
    getExecutionProfiles()
      .then((nextProfiles) => {
        if (!cancelled) setProfiles(nextProfiles);
      })
      .catch((error: unknown) => {
        console.error('[ChatInterface] execution profile load failed', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const profile = useMemo(
    () => profiles.find((candidate) => candidate.id === input.executionProfileId),
    [input.executionProfileId, profiles],
  );

  return useMemo(
    () => resolveRuntimeProfileLabel({ ...input, profile }),
    [input.backendModel, input.executionProfileId, input.personaModel, input.provider, profile],
  );
}
