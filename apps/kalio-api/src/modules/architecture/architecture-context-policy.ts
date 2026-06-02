import type { ArchitectureSchema } from '@kalio/types';

export function cloneArchitectureContextPolicy(
  policy: ArchitectureSchema['contextPolicy'],
): ArchitectureSchema['contextPolicy'] {
  return {
    ...policy,
    perSlotOverrides: policy.perSlotOverrides
      ? Object.fromEntries(Object.entries(policy.perSlotOverrides).map(([slotId, override]) => [
          slotId,
          { ...override },
        ]))
      : undefined,
  };
}

export function isArchitectureContextPolicy(value: unknown): value is ArchitectureSchema['contextPolicy'] {
  return isPlainRecord(value)
    && typeof value.includeUserTask === 'boolean'
    && typeof value.includeProjectMemory === 'boolean'
    && typeof value.includeBrowserSession === 'boolean'
    && typeof value.includePriorDecisions === 'boolean'
    && (value.includeOtherAgentOutputs === undefined || typeof value.includeOtherAgentOutputs === 'boolean')
    && (value.includeToolResults === undefined || typeof value.includeToolResults === 'boolean')
    && (value.contextCompression === undefined || isContextCompression(value.contextCompression))
    && (value.perSlotOverrides === undefined || isContextPolicyOverrides(value.perSlotOverrides));
}

function isContextPolicyOverrides(value: unknown): value is NonNullable<ArchitectureSchema['contextPolicy']['perSlotOverrides']> {
  return isPlainRecord(value) && Object.values(value).every((entry) => (
    isPlainRecord(entry)
    && (entry.includeUserTask === undefined || typeof entry.includeUserTask === 'boolean')
    && (entry.includeProjectMemory === undefined || typeof entry.includeProjectMemory === 'boolean')
    && (entry.includeBrowserSession === undefined || typeof entry.includeBrowserSession === 'boolean')
    && (entry.includePriorDecisions === undefined || typeof entry.includePriorDecisions === 'boolean')
    && (entry.includeOtherAgentOutputs === undefined || typeof entry.includeOtherAgentOutputs === 'boolean')
    && (entry.includeToolResults === undefined || typeof entry.includeToolResults === 'boolean')
    && (entry.contextCompression === undefined || isContextCompression(entry.contextCompression))
  ));
}

function isContextCompression(value: unknown): value is NonNullable<ArchitectureSchema['contextPolicy']['contextCompression']> {
  return value === 'none' || value === 'summary' || value === 'evidence_only';
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
