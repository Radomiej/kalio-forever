import { isLocalLlmProviderConfig, PROVIDER_LABELS } from './llm-provider-settings';
import type { ActiveRuntimeConfig, LLMConfigWithSource } from './llm-panel.types';

export function buildLLMPanelDerivedState({
  activeRuntimeConfig,
  runtimeConfig,
  lastEnvRuntimeConfig,
  showForm,
  allowsKeylessAuth,
}: {
  activeRuntimeConfig: ActiveRuntimeConfig | null;
  runtimeConfig: LLMConfigWithSource | null;
  lastEnvRuntimeConfig: LLMConfigWithSource | null;
  showForm: boolean;
  allowsKeylessAuth: boolean;
}) {
  const envRuntimeSnapshot = runtimeConfig?.source === 'env' ? runtimeConfig : lastEnvRuntimeConfig;
  return {
    envFallbackProviderId: envRuntimeSnapshot?.provider ?? 'env',
    envFallbackProviderLabel: envRuntimeSnapshot
      ? (PROVIDER_LABELS[envRuntimeSnapshot.provider] ?? envRuntimeSnapshot.provider)
      : undefined,
    envFallbackModel: envRuntimeSnapshot?.model,
    providerEmptyStateMessage: runtimeConfig?.source === 'env'
      ? 'No credentials configured. Runtime currently uses the env fallback.'
      : 'No credentials configured. Add one below.',
    activeProviderLabel: activeRuntimeConfig
      ? (PROVIDER_LABELS[activeRuntimeConfig.provider] ?? activeRuntimeConfig.provider)
      : 'Not configured',
    activeProviderModel: activeRuntimeConfig?.model || 'No model selected',
    activeProviderSource: activeRuntimeConfig
      ? (activeRuntimeConfig.source === 'env' ? 'env fallback' : 'database')
      : 'unknown',
    showWindowsLocalHint: Boolean(
      (activeRuntimeConfig && isLocalLlmProviderConfig(activeRuntimeConfig.provider, activeRuntimeConfig.baseUrl || undefined))
        || (showForm && allowsKeylessAuth),
    ),
  };
}
