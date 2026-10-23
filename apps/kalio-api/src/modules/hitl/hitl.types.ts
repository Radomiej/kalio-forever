import type { AgentRunContext, HitlConfig as SharedHitlConfig } from '@kalio/types';
import type {
  HitlApprovalKind,
  HitlMode,
  HitlRuleDecision,
} from '@kalio/types';

export type {
  HitlApprovalKind,
  HitlConfig,
  HitlHardRule,
  HitlHardRuleInput,
  HitlMode,
  HitlRuleDecision,
  UpdateHitlConfigDto,
} from '@kalio/types';

export const HITL_MODES: readonly HitlMode[] = ['manual', 'auto', 'bypass', 'jev'];
export type ResolvedHitlConfig = SharedHitlConfig & Required<Pick<SharedHitlConfig,
  'jevInstructions' | 'jevApprovalThreshold' | 'jevFallbackToPersona' | 'rules'
>>;
export type HitlUnattendedFallback = SharedHitlConfig['unattendedFallback'];
export type HitlNotificationChannel = SharedHitlConfig['notificationChannel'];
export type HitlApprovalStatus = 'manual' | 'approved' | 'rejected';
export type HitlApprovalSource = 'manual' | 'auto' | 'bypass' | 'representative' | 'jev' | 'rule';

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
  decision?: HitlRuleDecision;
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
