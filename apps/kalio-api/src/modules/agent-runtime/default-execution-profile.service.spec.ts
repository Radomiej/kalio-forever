import { describe, expect, it, vi } from 'vitest';
import { DefaultExecutionProfileService } from './default-execution-profile.service';
import type { AppSettingsService } from '../../database/app-settings.service';
import type { ExecutionProfileService } from './execution-profile.service';

function fixture() {
  const values = new Map<string, string>();
  const settings = { get: vi.fn(async (key: string) => values.get(key) ?? null), set: vi.fn(async (key: string, value: string) => { values.set(key, value); }) };
  const profiles = { assertEnabled: vi.fn(async (id: string) => ({ id, kind: 'devin-cli-acp', model: 'swe-2' })) };
  const create = () => new DefaultExecutionProfileService(settings as unknown as AppSettingsService, profiles as unknown as ExecutionProfileService);
  return { settings, profiles, create };
}

describe('DefaultExecutionProfileService', () => {
  it('starts unset and preserves the explicitly selected Devin across service recreation', async () => {
    const f = fixture();
    expect(await f.create().getId()).toBeNull();
    await f.create().select('devin-swe-2');
    expect(await f.create().getId()).toBe('devin-swe-2');
  });

  it('does not overwrite the saved selection when a profile becomes unavailable', async () => {
    const f = fixture();
    await f.create().select('devin-swe-2');
    f.profiles.assertEnabled.mockRejectedValueOnce(new Error('disabled'));
    await expect(f.create().select('disabled')).rejects.toThrow('disabled');
    expect(await f.create().getId()).toBe('devin-swe-2');
  });

  it('rejects empty selections without writing settings', async () => {
    const f = fixture();
    await expect(f.create().select('  ')).rejects.toThrow();
    expect(f.settings.set).not.toHaveBeenCalled();
  });

  it('checks the saved Devin once on startup without resetting the choice', async () => {
    const f = fixture();
    await f.create().select('devin-swe-2');
    const getStatus = vi.fn().mockResolvedValue({ authenticated: false });
    const service = new DefaultExecutionProfileService(
      f.settings as unknown as AppSettingsService,
      f.profiles as unknown as ExecutionProfileService,
      { getStatus } as unknown as import('./devin-cli-probe.service').DevinCliProbeService,
    );
    await service.onApplicationBootstrap();
    expect(getStatus).toHaveBeenCalledExactlyOnceWith(true);
    expect(await service.getId()).toBe('devin-swe-2');
  });
});
