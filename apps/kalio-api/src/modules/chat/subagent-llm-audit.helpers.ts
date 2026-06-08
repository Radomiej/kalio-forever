import type { LLMConfig } from '@kalio/types';

type RuntimeLLMConfig = Pick<LLMConfig, 'provider' | 'model'> & {
  source?: 'db' | 'env' | 'persona' | 'request';
};

export function buildSubagentLLMAuditData(
  runtimeConfig: RuntimeLLMConfig | undefined,
  personaModel: string | undefined,
  requestModel: string | undefined,
) {
  const requestOverride = requestModel?.trim();
  const personaOverride = personaModel?.trim();
  const override = requestOverride || personaOverride;
  return {
    provider: runtimeConfig?.provider,
    model: override || runtimeConfig?.model,
    modelSource: requestOverride ? 'request' : personaOverride ? 'persona' : runtimeConfig?.source,
    personaModel: personaOverride ?? '',
    requestModel: requestOverride ?? '',
  };
}
