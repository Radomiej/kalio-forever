export interface ToolTimeoutSettings {
  webSearchTimeoutMs: number;
  providerLocalTimeoutMs: number;
  providerRemoteTimeoutMs: number;
}

export type ToolTimeoutKey = keyof ToolTimeoutSettings;

export const DEFAULT_TOOL_TIMEOUT_SETTINGS: ToolTimeoutSettings = {
  webSearchTimeoutMs: 120000,
  providerLocalTimeoutMs: 3000,
  providerRemoteTimeoutMs: 15000,
};

const TOOL_TIMEOUT_BOUNDS: Record<ToolTimeoutKey, { min: number; max: number }> = {
  webSearchTimeoutMs: { min: 15000, max: 600000 },
  providerLocalTimeoutMs: { min: 1000, max: 30000 },
  providerRemoteTimeoutMs: { min: 5000, max: 120000 },
};

export function normalizeToolTimeout(key: ToolTimeoutKey, value: number): number {
  const bounds = TOOL_TIMEOUT_BOUNDS[key];
  return Math.max(bounds.min, Math.min(bounds.max, Math.round(value)));
}