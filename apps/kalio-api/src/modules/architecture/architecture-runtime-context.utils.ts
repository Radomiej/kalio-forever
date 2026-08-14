import type { ArchitectureVfsHydrationResult } from './architecture-vfs-hydration';

export const ARCHITECTURE_CLI_AGENT_IDS = ['copilot', 'codex', 'gemini', 'claude'] as const;
export type ArchitectureCliAgentId = (typeof ARCHITECTURE_CLI_AGENT_IDS)[number];

export interface ArchitectureCliAgentConfigSnapshot {
  agentId: string;
  enabled: boolean;
  model?: string;
  architecturePreference?: string;
}

export interface BuildArchitectureVfsEvidenceContextInput {
  rootSessionId: string;
  hydration: ArchitectureVfsHydrationResult | null;
  readFile: (path: string) => Buffer;
  maxFiles?: number;
  maxExcerptBytes?: number;
  maxTotalBytes?: number;
}

export function buildArchitectureCliAgentContext(
  context: Record<string, unknown> | undefined,
  configs: ArchitectureCliAgentConfigSnapshot[],
): Record<string, unknown> | undefined {
  if (context?.['cliAgentToolPreferences'] !== undefined || context?.['availableCliAgents'] !== undefined) {
    return context;
  }
  const preferences: Record<string, { model?: string; preference?: string }> = {};
  const availableCliAgents: string[] = [];
  for (const config of configs) {
    if (!config.enabled) {
      continue;
    }
    availableCliAgents.push(config.agentId);
    const model = trimNonEmpty(config.model);
    const preference = trimNonEmpty(config.architecturePreference);
    if (model || preference) {
      preferences[config.agentId] = { ...(model ? { model } : {}), ...(preference ? { preference } : {}) };
    }
  }
  return {
    ...(context ?? {}),
    availableCliAgents,
    architectureCliAgentsEnabled: availableCliAgents.length > 0,
    ...(Object.keys(preferences).length > 0 ? { cliAgentToolPreferences: preferences } : {}),
  };
}

export function buildArchitectureVfsEvidenceContext(
  context: Record<string, unknown> | undefined,
  input: BuildArchitectureVfsEvidenceContextInput,
): Record<string, unknown> | undefined {
  const { hydration } = input;
  if (!hydration || hydration.copiedFiles.length === 0) {
    return context;
  }

  const maxFiles = input.maxFiles ?? 12;
  const maxExcerptBytes = input.maxExcerptBytes ?? 1600;
  const maxTotalBytes = input.maxTotalBytes ?? 12_000;
  let totalBytes = 0;
  const files: Array<{ path: string; sizeBytes: number; excerpt: string; truncated: boolean }> = [];
  for (const file of hydration.copiedFiles.slice(0, maxFiles)) {
    if (totalBytes >= maxTotalBytes) break;
    const buffer = input.readFile(file.toPath);
    const remainingBytes = Math.max(0, maxTotalBytes - totalBytes);
    const excerptBytes = Math.min(maxExcerptBytes, remainingBytes, buffer.length);
    const excerpt = buffer.subarray(0, excerptBytes).toString('utf8');
    files.push({
      path: file.toPath,
      sizeBytes: file.sizeBytes,
      excerpt,
      truncated: excerptBytes < buffer.length,
    });
    totalBytes += excerptBytes;
  }

  return {
    ...(context ?? {}),
    architectureVfsEvidence: {
      rootSessionId: input.rootSessionId,
      sourceSessionId: hydration.fromSessionId,
      totalCopiedFiles: hydration.copiedFiles.length,
      files,
    },
  };
}

function trimNonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}
