import { describe, expect, it, vi } from 'vitest';
import type { EmbeddingService } from './embedding.service';
import { ProjectContextSettingsController } from './project-context-settings.controller';
import { ProjectContextSettingsService } from './project-context-settings.service';
import type { AppSettingsService } from '../../database/app-settings.service';

describe('settings controller derived identity', () => {
  it('persists policy without reloading the provider and ignores manual identity', async () => {
    let stored: string | null = null;
    const settings = new ProjectContextSettingsService({ get: async () => stored,
      set: async (_key: string, value: string) => { stored = value; } } as unknown as AppSettingsService);
    const reload = vi.fn().mockRejectedValue(new Error('provider failed'));
    const controller = new ProjectContextSettingsController(settings, { reloadFromCredential: reload,
      ensureCurrentIdentity: async () => ({ modelRevision: 'digest', providerScope: 'scope' }) } as unknown as EmbeddingService);
    const next = { enabled: true, modelRevision: 'revision', providerScope: 'local-user' };
    expect(await controller.put(next)).toEqual({ enabled: true, modelRevision: 'digest', providerScope: 'scope' });
    expect(await controller.put({ enabled: false })).toEqual({ enabled: false, modelRevision: 'digest', providerScope: 'scope' });
    expect((await settings.get()).enabled).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
  it('persists before reload and rejects malformed input without reload', async () => {
    let stored: string | null = null;
    const settings = new ProjectContextSettingsService({ get: async () => stored, set: async (_key: string, value: string) => { stored = value; } } as unknown as AppSettingsService);
    const reload = vi.fn(async () => { expect((await settings.get()).enabled).toBe(true); return { modelRevision: 'derived', providerScope: 'scope' }; });
    const controller = new ProjectContextSettingsController(settings, { ensureCurrentIdentity: reload } as unknown as EmbeddingService);
    const next = { enabled: true, modelRevision: 'rev2', providerScope: 'local-user' };
    expect(await controller.put(next)).toEqual({ enabled: true, modelRevision: 'derived', providerScope: 'scope' });
    expect(await controller.get()).toEqual({ enabled: true, modelRevision: 'derived', providerScope: 'scope' });
    expect(reload).toHaveBeenCalledTimes(2);
    await expect(controller.put({ ...next, extra: true })).rejects.toThrow();
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
