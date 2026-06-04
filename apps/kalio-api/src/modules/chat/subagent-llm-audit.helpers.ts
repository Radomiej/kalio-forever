import type { LLMConfig } from '@kalio/types';

type RuntimeLLMConfig = Pick<LLMConfig, 'provider' | 'model'> & {
  source?: 'db' | 'env' | 'persona';
};

export function buildSubagentLLMAuditData(runtimeConfig: RuntimeLLMConfig | undefined, personaModel: string | undefined) {
  const override = personaModel?.trim();
  return {
    provider: runtimeConfig?.provider,
    model: override || runtimeConfig?.model,
    modelSource: override ? 'persona' : runtimeConfig?.source,
    personaModel: override ?? '',
  };
}
