export type HitlMode = 'manual' | 'auto' | 'bypass' | 'jev';
export type HitlApprovalKind = 'tool' | 'raapp_native' | 'external_security';
export type HitlRuleDecision = 'allow' | 'deny' | 'ask_user';

export interface HitlHardRule {
  id: string;
  kind: '*' | HitlApprovalKind;
  name: string;
  decision: HitlRuleDecision;
  executable?: string;
  argumentsContains?: string;
}

export type HitlHardRuleInput = Omit<HitlHardRule, 'id'> & { id?: string };

export interface HitlConfig {
  mode: HitlMode;
  autoPersonaId: string | null;
  unattendedFallback: 'pause' | 'representative';
  representativePersonaId: string | null;
  notificationChannel: 'none' | 'telegram';
  externalPolicyEnabled: boolean;
  externalPolicyPersonaId: string | null;
  raAppApprovalTimeoutMs: number;
  jevApprovalThreshold?: number;
  jevInstructions?: string;
  jevFallbackToPersona?: boolean;
  rules?: HitlHardRule[];
}

export interface UpdateHitlConfigDto extends Omit<Partial<HitlConfig>, 'mode' | 'rules'> {
  mode: HitlMode;
  rules?: HitlHardRuleInput[];
}
