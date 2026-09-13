import { describe, expect, it, vi } from 'vitest';
import type { AppSettingsService } from '../../database/app-settings.service';
import { DEVIN_NATIVE_TOOLS_SETTING_KEY, DevinNativeToolsPolicyService } from './devin-native-tools-policy.service';

describe('DevinNativeToolsPolicyService', () => {
  it('defaults every provider-native category to blocked', async () => {
    const appSettings = { get: vi.fn(async () => null), set: vi.fn(async () => undefined) } as unknown as AppSettingsService;
    await expect(new DevinNativeToolsPolicyService(appSettings).get()).resolves.toEqual({
      filesystem: false,
      web: false,
      terminal: false,
      source: 'default',
    });
  });

  it('persists and reads the three category switches', async () => {
    let stored: string | null = null;
    const appSettings = {
      get: vi.fn(async () => stored),
      set: vi.fn(async (_key: string, value: string) => { stored = value; }),
    } as unknown as AppSettingsService;
    const service = new DevinNativeToolsPolicyService(appSettings);
    await expect(service.update({ filesystem: true, web: false, terminal: true })).resolves.toEqual({
      filesystem: true,
      web: false,
      terminal: true,
      source: 'settings',
    });
    expect(appSettings.set).toHaveBeenCalledWith(DEVIN_NATIVE_TOOLS_SETTING_KEY, '{"filesystem":true,"web":false,"terminal":true}');
    await expect(service.get()).resolves.toMatchObject({ filesystem: true, web: false, terminal: true, source: 'settings' });
  });
});
