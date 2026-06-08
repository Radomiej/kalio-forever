export type HitlMode = 'manual' | 'auto' | 'bypass';
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
