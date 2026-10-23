import type { HitlConfig as SharedHitlConfig, HitlMode as SharedHitlMode } from '@kalio/types';

export type HitlConfig = SharedHitlConfig;
export type HitlMode = SharedHitlMode;
export type HitlUnattendedFallback = SharedHitlConfig['unattendedFallback'];
export type HitlNotificationChannel = SharedHitlConfig['notificationChannel'];
