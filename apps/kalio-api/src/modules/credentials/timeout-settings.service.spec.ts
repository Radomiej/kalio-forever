import { BadRequestException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DrizzleService } from '../../database/drizzle.service';
import { AppSettingsService } from '../../database/app-settings.service';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../database/schema';
import type { KalioConfigService } from '../../config/kalio-config.service';
import { TimeoutSettingsService } from './timeout-settings.service';

function makeTestDrizzle(): DrizzleService {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  const db = drizzle(sqlite, { schema });

  const drizzleSvc = new DrizzleService(null as never);
  (drizzleSvc as unknown as { db: typeof db }).db = db;
  return drizzleSvc;
}

describe('TimeoutSettingsService', () => {
  let service: TimeoutSettingsService;

  beforeEach(() => {
    const drizzleService = makeTestDrizzle();
    const appSettings = new AppSettingsService(drizzleService);
    service = new TimeoutSettingsService(appSettings);
  });

  function makeKalioConfigMock(
    overrides: Awaited<ReturnType<KalioConfigService['getToolTimeoutSettings']>>,
  ): Pick<KalioConfigService, 'getToolTimeoutSettings'> {
    return {
      getToolTimeoutSettings: vi.fn().mockResolvedValue(overrides),
    };
  }

  it('returns default timeout settings when nothing is persisted', async () => {
    await expect(service.getTimeoutSettings()).resolves.toEqual({
      providerRequestTimeoutMs: 120_000,
      webSearchTimeoutMs: 120_000,
      providerLocalTimeoutMs: 3_000,
      providerRemoteTimeoutMs: 15_000,
      providerMaxConcurrentStreams: 2,
    });
  });

  it('persists timeout settings and exposes provider helper values', async () => {
    await service.setTimeoutSettings({
      webSearchTimeoutMs: 180_000,
      providerLocalTimeoutMs: 7_000,
      providerRemoteTimeoutMs: 45_000,
      providerMaxConcurrentStreams: 3,
    });

    await expect(service.getTimeoutSettings()).resolves.toEqual({
      providerRequestTimeoutMs: 120_000,
      webSearchTimeoutMs: 180_000,
      providerLocalTimeoutMs: 7_000,
      providerRemoteTimeoutMs: 45_000,
      providerMaxConcurrentStreams: 3,
    });
    await expect(service.getWebSearchTimeoutMs()).resolves.toBe(180_000);
    await expect(service.getProviderTimeoutMs(true)).resolves.toBe(7_000);
    await expect(service.getProviderTimeoutMs(false)).resolves.toBe(45_000);
    await expect(service.getProviderMaxConcurrentStreams()).resolves.toBe(3);
  });

  it('clamps timeout settings to safe bounds', async () => {
    await service.setTimeoutSettings({
      webSearchTimeoutMs: 1,
      providerLocalTimeoutMs: 999_999,
      providerRemoteTimeoutMs: 2_000,
      providerMaxConcurrentStreams: 999,
    });

    await expect(service.getTimeoutSettings()).resolves.toEqual({
      providerRequestTimeoutMs: 120_000,
      webSearchTimeoutMs: 15_000,
      providerLocalTimeoutMs: 30_000,
      providerRemoteTimeoutMs: 5_000,
      providerMaxConcurrentStreams: 20,
    });
  });

  it('falls back to defaults for malformed persisted values', async () => {
    const drizzleService = makeTestDrizzle();
    const appSettings = new AppSettingsService(drizzleService);
    const malformedService = new TimeoutSettingsService(appSettings);

    await appSettings.set('tool_timeout_provider_remote_ms', '20000oops');

    await expect(malformedService.getTimeoutSettings()).resolves.toEqual({
      providerRequestTimeoutMs: 120_000,
      webSearchTimeoutMs: 120_000,
      providerLocalTimeoutMs: 3_000,
      providerRemoteTimeoutMs: 15_000,
      providerMaxConcurrentStreams: 2,
    });
  });

  it('prefers TOML-managed timeout settings over persisted values', async () => {
    const appSettings = {
      get: vi.fn(async (key: string) => (key === 'tool_timeout_provider_remote_ms' ? '22000' : '180000')),
      set: vi.fn(),
    };
    const kalioConfig = makeKalioConfigMock({
      webSearchTimeoutMs: 250_000,
      providerLocalTimeoutMs: 8_000,
      providerMaxConcurrentStreams: 4,
    });
    const configManagedService = new TimeoutSettingsService(appSettings as never, kalioConfig as never);

    await expect(configManagedService.getTimeoutSettings()).resolves.toEqual({
      providerRequestTimeoutMs: 180_000,
      webSearchTimeoutMs: 250_000,
      providerLocalTimeoutMs: 8_000,
      providerRemoteTimeoutMs: 22_000,
      providerMaxConcurrentStreams: 4,
    });
    expect(appSettings.get).toHaveBeenCalledTimes(2);
    expect(appSettings.get).toHaveBeenCalledWith('tool_timeout_provider_remote_ms');
  });

  it('reads only the web search timeout key for getWebSearchTimeoutMs', async () => {
    const appSettings = {
      get: vi.fn().mockResolvedValue('180000'),
      set: vi.fn(),
    };
    const directGetterService = new TimeoutSettingsService(appSettings as never);

    await expect(directGetterService.getWebSearchTimeoutMs()).resolves.toBe(180_000);
    expect(appSettings.get).toHaveBeenCalledTimes(1);
    expect(appSettings.get).toHaveBeenCalledWith('tool_timeout_web_search_ms');
  });

  it('uses TOML-managed values for direct timeout helpers', async () => {
    const appSettings = {
      get: vi.fn().mockResolvedValue('180000'),
      set: vi.fn(),
    };
    const kalioConfig = makeKalioConfigMock({
      webSearchTimeoutMs: 240_000,
      providerRemoteTimeoutMs: 31_000,
      providerMaxConcurrentStreams: 5,
    });
    const configManagedService = new TimeoutSettingsService(appSettings as never, kalioConfig as never);

    await expect(configManagedService.getWebSearchTimeoutMs()).resolves.toBe(240_000);
    await expect(configManagedService.getProviderTimeoutMs(false)).resolves.toBe(31_000);
    await expect(configManagedService.getProviderMaxConcurrentStreams()).resolves.toBe(5);
    expect(appSettings.get).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when writing a TOML-managed timeout key', async () => {
    const appSettings = { get: vi.fn().mockResolvedValue(null), set: vi.fn() };
    const kalioConfig = makeKalioConfigMock({ webSearchTimeoutMs: 240_000 });
    const configManagedService = new TimeoutSettingsService(appSettings as never, kalioConfig as never);

    await expect(
      configManagedService.setTimeoutSettings({ webSearchTimeoutMs: 180_000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      configManagedService.setTimeoutSettings({ webSearchTimeoutMs: 180_000 }),
    ).rejects.toThrow(/\.kalio\/config\.toml/);
    expect(appSettings.set).not.toHaveBeenCalled();
  });

  it('allows writing non-managed keys when TOML manages other keys', async () => {
    const appSettings = { get: vi.fn().mockResolvedValue(null), set: vi.fn() };
    const kalioConfig = makeKalioConfigMock({ webSearchTimeoutMs: 240_000 });
    const configManagedService = new TimeoutSettingsService(appSettings as never, kalioConfig as never);

    await expect(
      configManagedService.setTimeoutSettings({ providerLocalTimeoutMs: 5_000 }),
    ).resolves.toBeUndefined();
    expect(appSettings.set).toHaveBeenCalledWith('tool_timeout_provider_local_ms', '5000');
  });

  it('throws when ALL requested keys are TOML-managed', async () => {
    const appSettings = { get: vi.fn().mockResolvedValue(null), set: vi.fn() };
    const kalioConfig = makeKalioConfigMock({
      webSearchTimeoutMs: 240_000,
      providerLocalTimeoutMs: 8_000,
      providerRemoteTimeoutMs: 31_000,
      providerMaxConcurrentStreams: 4,
    });
    const configManagedService = new TimeoutSettingsService(appSettings as never, kalioConfig as never);

    await expect(
      configManagedService.setTimeoutSettings({
        webSearchTimeoutMs: 120_000,
        providerLocalTimeoutMs: 3_000,
        providerRemoteTimeoutMs: 15_000,
        providerMaxConcurrentStreams: 2,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(appSettings.set).not.toHaveBeenCalled();
  });
  it('persists generation timeout independently of probe timeouts across service recreation', async () => {
    const appSettings = new AppSettingsService(makeTestDrizzle());
    const first = new TimeoutSettingsService(appSettings);
    await expect(first.getProviderRequestTimeoutMs()).resolves.toBe(120_000);
    await first.setTimeoutSettings({ providerRequestTimeoutMs: 600_000 });
    const restarted = new TimeoutSettingsService(appSettings);
    await expect(restarted.getProviderRequestTimeoutMs()).resolves.toBe(600_000);
    await expect(restarted.getProviderTimeoutMs(true)).resolves.toBe(3_000);
    await restarted.setTimeoutSettings({ providerRequestTimeoutMs: 0 });
    await expect(restarted.getProviderRequestTimeoutMs()).resolves.toBe(1_000);
    await restarted.setTimeoutSettings({ providerRequestTimeoutMs: 2_000_000 });
    await expect(restarted.getProviderRequestTimeoutMs()).resolves.toBe(1_800_000);
  });

  it('honors TOML request timeout and prevents overriding its managed value', async () => {
    const appSettings = { get: vi.fn().mockResolvedValue('120000'), set: vi.fn() };
    const managed = new TimeoutSettingsService(appSettings as never,
      makeKalioConfigMock({ providerRequestTimeoutMs: 600000 }) as never);
    await expect(managed.getProviderRequestTimeoutMs()).resolves.toBe(600000);
    await expect(managed.setTimeoutSettings({ providerRequestTimeoutMs: 300000 })).rejects.toBeInstanceOf(BadRequestException);
    expect(appSettings.set).not.toHaveBeenCalled();
  });

});
