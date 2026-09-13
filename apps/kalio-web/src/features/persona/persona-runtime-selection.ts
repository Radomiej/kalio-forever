import type { Credential, ExecutionProfile, ExecutionProfileKind } from '@kalio/types';

export type PersonaRuntimeKind = ExecutionProfileKind;

export interface NativeModelOption {
  model: string;
  profile: ExecutionProfile;
}

export const RUNTIME_KIND_LABELS: Record<PersonaRuntimeKind, string> = {
  'direct-llm': 'Direct LLM',
  'codex-app-server': 'ChatGPT / Codex',
  'claude-agent-sdk': 'Claude Code',
  'devin-api': 'Devin Cloud',
  'devin-cli-acp': 'Devin CLI (host)',
};

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  cometapi: 'CometAPI',
  xiaomimimo: 'Xiaomi MiMo',
  ollama: 'Ollama',
  deepseek: 'DeepSeek',
  bitnet: 'BitNet',
  custom: 'Custom',
};

export function runtimeKindLabel(kind: PersonaRuntimeKind): string {
  return RUNTIME_KIND_LABELS[kind];
}

export function providerLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  return PROVIDER_LABELS[normalized] ?? provider;
}

export function formatCredentialOption(credential: Credential): string {
  const model = credential.model?.trim();
  return [providerLabel(credential.provider), credential.name, model].filter(Boolean).join(' · ');
}

export function nativeModelOptions(
  profiles: ExecutionProfile[],
  kind: Exclude<PersonaRuntimeKind, 'direct-llm'>,
): NativeModelOption[] {
  const seen = new Set<string>();
  return profiles
    .filter((profile) => profile.enabled && profile.kind === kind && profile.model.trim())
    .sort((left, right) => left.model.localeCompare(right.model) || left.name.localeCompare(right.name))
    .filter((profile) => {
      const key = profile.model.trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((profile) => ({ model: profile.model, profile: preferredProfile(profiles, kind, profile.model) }));
}

export function nativeReasoningOptions(
  profiles: ExecutionProfile[],
  kind: Exclude<PersonaRuntimeKind, 'direct-llm'>,
  model: string,
): string[] {
  const values = new Set<string>();
  profiles
    .filter((profile) => profile.enabled && profile.kind === kind && profile.model === model)
    .forEach((profile) => values.add(profile.reasoningEffort?.trim() ?? ''));
  return [...values].sort((left, right) => {
    if (left === '') return -1;
    if (right === '') return 1;
    return left.localeCompare(right);
  });
}

export function preferredProfile(
  profiles: ExecutionProfile[],
  kind: Exclude<PersonaRuntimeKind, 'direct-llm'>,
  model: string,
  reasoningEffort?: string,
): ExecutionProfile {
  const normalizedReasoning = reasoningEffort?.trim() ?? '';
  const candidates = profiles.filter((profile) => (
    profile.enabled
    && profile.kind === kind
    && profile.model === model
    && (reasoningEffort === undefined || (profile.reasoningEffort?.trim() ?? '') === normalizedReasoning)
  ));
  if (candidates.length === 0) {
    throw new Error(`No enabled ${kind} profile for ${model} (${normalizedReasoning || 'default'}).`);
  }
  return [...candidates].sort((left, right) => {
    const strictRank = Number(right.approvalMode === 'kalio_strict') - Number(left.approvalMode === 'kalio_strict');
    return strictRank || left.id.localeCompare(right.id);
  })[0]!;
}

export function findProfile(profiles: ExecutionProfile[], id: string | undefined): ExecutionProfile | undefined {
  return id ? profiles.find((profile) => profile.id === id) : undefined;
}

export function findDirectProfile(
  profiles: ExecutionProfile[],
  credentialId: string,
  provider: string,
  model: string,
): ExecutionProfile | undefined {
  return profiles.find((profile) => (
    profile.enabled
    && profile.kind === 'direct-llm'
    && profile.authProfileId === credentialId
    && profile.provider === provider
    && profile.model === model
  ));
}
