import type { AgentRunContext } from '@kalio/types';

export const HITL_MODES = ['manual', 'auto', 'bypass'] as const;

export type HitlMode = typeof HITL_MODES[number];
export type HitlUnattendedFallback = 'pause' | 'representative';
export type HitlNotificationChannel = 'none' | 'telegram';

export interface HitlConfig {
  mode: HitlMode;
  autoPersonaId: string | null;
  unattendedFallback: HitlUnattendedFallback;
  representativePersonaId: string | null;
  notificationChannel: HitlNotificationChannel;
  externalPolicyEnabled: boolean;
  externalPolicyPersonaId: string | null;
  raAppApprovalTimeoutMs: number;
}

export interface UpdateHitlConfigDto {
  mode: HitlMode;
  autoPersonaId?: string | null;
  unattendedFallback?: HitlUnattendedFallback;
  representativePersonaId?: string | null;
  notificationChannel?: HitlNotificationChannel;
  externalPolicyEnabled?: boolean;
  externalPolicyPersonaId?: string | null;
  raAppApprovalTimeoutMs?: number;
}

export type HitlApprovalKind = 'tool' | 'raapp_native' | 'external_security';
export type HitlApprovalStatus = 'manual' | 'approved' | 'rejected';
export type HitlApprovalSource = 'manual' | 'auto' | 'bypass' | 'representative';

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
  risk?: 'low' | 'medium' | 'high' | 'critical';
  decision?: 'allow' | 'deny' | 'ask_user';
}

export function isHitlMode(value: string | null | undefined): value is HitlMode {
  return typeof value === 'string' && (HITL_MODES as readonly string[]).includes(value);
}

export function isHitlUnattendedFallback(value: string | null | undefined): value is HitlUnattendedFallback {
  return value === 'pause' || value === 'representative';
}

export function isHitlNotificationChannel(value: string | null | undefined): value is HitlNotificationChannel {
  return value === 'none' || value === 'telegram';
}
