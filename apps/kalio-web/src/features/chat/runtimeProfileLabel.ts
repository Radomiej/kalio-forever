import type { ExecutionProfile } from '@kalio/types';

export interface RuntimeProfileLabelInput {
  executionProfileId?: string;
  profile?: ExecutionProfile;
  provider?: string;
  personaModel?: string;
  backendModel?: string;
}

export interface RuntimeProfileLabel {
  provider: string | null;
  model: string | null;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'ChatGPT',
  openrouter: 'OpenRouter',
  cometapi: 'CometAPI',
  xiaomimimo: 'MiMo',
  ollama: 'Ollama',
  deepseek: 'DeepSeek',
  bitnet: 'BitNet',
  custom: 'Custom LLM',
  mock: 'Local LLM',
};

export function executionProfileProviderLabel(profile: ExecutionProfile): string {
  if (profile.kind === 'codex-app-server') return 'ChatGPT / Codex';
  if (profile.kind === 'claude-agent-sdk') return 'Claude Code';
  if (profile.kind === 'devin-api') return 'Devin Cloud';
  if (profile.kind === 'devin-cli-acp') return 'Devin CLI';
  return PROVIDER_LABELS[profile.provider?.toLowerCase() ?? ''] ?? profile.provider ?? profile.kind;
}

export function formatExecutionProfileOption(profile: ExecutionProfile): string {
  const reasoning = profile.reasoningEffort ? `reasoning ${profile.reasoningEffort}` : 'reasoning default';
  return `${executionProfileProviderLabel(profile)} · ${profile.model} · ${reasoning}`;
}

export function resolveRuntimeProfileLabel(input: RuntimeProfileLabelInput): RuntimeProfileLabel {
  const profileId = input.executionProfileId?.trim().toLowerCase();
  const kind = input.profile?.kind;
  const provider = input.profile?.provider?.toLowerCase() ?? input.provider?.trim().toLowerCase();

  let providerLabel: string | null = null;
  if (kind === 'codex-app-server' || profileId?.startsWith('codex-')) {
    providerLabel = 'Codex';
  } else if (kind === 'claude-agent-sdk' || profileId === 'claude-local') {
    providerLabel = 'Claude Code';
  } else if (kind === 'devin-cli-acp' || profileId?.startsWith('devin-local-')) {
    providerLabel = 'Devin CLI';
  } else if (kind === 'devin-api' || profileId?.startsWith('devin-')) {
    providerLabel = 'Devin Cloud';
  } else if (provider) {
    providerLabel = PROVIDER_LABELS[provider] ?? input.profile?.provider ?? input.provider ?? null;
  }

  const model = input.profile?.model
    ?? (profileId ? undefined : input.personaModel || input.backendModel);
  const normalizedModel = model?.trim();

  return {
    provider: providerLabel,
    model: normalizedModel && normalizedModel.toLowerCase() !== 'mock' ? normalizedModel : null,
  };
}
