import type { AgentRunContext } from '@kalio/types';

export const HITL_MODES = ['manual', 'auto', 'bypass'] as const;

export type HitlMode = typeof HITL_MODES[number];

export interface HitlConfig {
  mode: HitlMode;
  autoPersonaId: string | null;
}

export interface UpdateHitlConfigDto {
  mode: HitlMode;
  autoPersonaId?: string | null;
}

export type HitlApprovalKind = 'tool' | 'raapp_native';
export type HitlApprovalStatus = 'manual' | 'approved' | 'rejected';
export type HitlApprovalSource = 'manual' | 'auto' | 'bypass';

export interface HitlApprovalRequest {
  kind: HitlApprovalKind;
  sessionId: string;
  name: string;
  args: Record<string, unknown>;
  abortSignal?: AbortSignal;
  agentRun?: AgentRunContext;
  displayLabel?: string;
  toolCallId?: string;
}

export interface HitlApprovalResolution {
  status: HitlApprovalStatus;
  source: HitlApprovalSource;
  reason?: string;
}

export interface HitlDecisionInput {
  personaId: string;
  request: HitlApprovalRequest;
}

export interface HitlDecisionResult {
  agree: boolean;
  reason: string;
}

export function isHitlMode(value: string | null | undefined): value is HitlMode {
  return typeof value === 'string' && (HITL_MODES as readonly string[]).includes(value);
}