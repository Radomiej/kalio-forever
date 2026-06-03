import type { CLIAgentConfig } from '@kalio/types';

export type ConfigDraft = Partial<CLIAgentConfig>;

export const TIMEOUT_MIN_MS = 10_000;
export const TIMEOUT_MAX_MS = 86_400_000;
export const HARD_TIMEOUT_MIN_MS = 10_000;
export const HARD_TIMEOUT_MAX_MS = 86_400_000;
export const MAX_OUTPUT_MIN = 1_000;
export const MAX_OUTPUT_MAX = 500_000;

export function normalizeOptionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeCliPath(value: string): string {
  return normalizeOptionalText(value) ?? '';
}

export function normalizeModel(value: string): string {
  return normalizeOptionalText(value) ?? '';
}

export function normalizeArchitecturePreference(value: string): string {
  return normalizeOptionalText(value) ?? '';
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeNumberInput(value: string, fallback: number, min: number, max: number): number {
  if (value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampNumber(parsed, min, max) : fallback;
}

export function normalizeExtraArgs(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function modelPlaceholder(agentId: string): string {
  if (agentId === 'gemini') return 'e.g. gemini-2.5-pro';
  if (agentId === 'codex') return 'e.g. gpt-5.4-mini';
  if (agentId === 'claude') return 'e.g. opus';
  return 'Optional model name';
}

export function buildCliAgentPayload(config: CLIAgentConfig, draft: ConfigDraft): CLIAgentConfig {
  return {
    ...config,
    ...draft,
    cliPath: normalizeCliPath(draft.cliPath ?? config.cliPath),
    model: normalizeModel(draft.model ?? config.model),
    architecturePreference: normalizeArchitecturePreference(
      draft.architecturePreference ?? config.architecturePreference,
    ),
    timeoutMs: clampNumber(typeof draft.timeoutMs === 'number' ? draft.timeoutMs : config.timeoutMs, TIMEOUT_MIN_MS, TIMEOUT_MAX_MS),
    hardTimeoutEnabled: typeof draft.hardTimeoutEnabled === 'boolean'
      ? draft.hardTimeoutEnabled
      : config.hardTimeoutEnabled ?? false,
    hardTimeoutMs: clampNumber(
      typeof draft.hardTimeoutMs === 'number' ? draft.hardTimeoutMs : config.hardTimeoutMs ?? 3_600_000,
      HARD_TIMEOUT_MIN_MS,
      HARD_TIMEOUT_MAX_MS,
    ),
    autoRecoveryEnabled: typeof draft.autoRecoveryEnabled === 'boolean'
      ? draft.autoRecoveryEnabled
      : config.autoRecoveryEnabled ?? false,
    autoRecoveryPrompt: normalizeOptionalText(draft.autoRecoveryPrompt ?? config.autoRecoveryPrompt ?? 'continue') ?? 'continue',
    maxOutputChars: clampNumber(
      typeof draft.maxOutputChars === 'number' ? draft.maxOutputChars : config.maxOutputChars,
      MAX_OUTPUT_MIN,
      MAX_OUTPUT_MAX,
    ),
    extraArgs: Array.isArray(draft.extraArgs) ? draft.extraArgs : config.extraArgs,
  };
}
