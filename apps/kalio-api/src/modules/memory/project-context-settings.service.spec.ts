import { describe, expect, it, vi } from 'vitest';
import type { AppSettingsService } from '../../database/app-settings.service';
import { ProjectContextSettingsService } from './project-context-settings.service';

describe('project context settings', () => {
  function fixture() {
    const values = new Map<string, string>([['active_embedding_credential', 'keep']]);
    const store = { get: async (key: string) => values.get(key) ?? null,
      set: vi.fn(async (key: string, value: string) => { values.set(key, value); }) };
    return { values, store, service: new ProjectContextSettingsService(store as unknown as AppSettingsService) };
  }
  it('defaults off, persists exact settings, and preserves provider configuration', async () => {
    const f = fixture();
    expect(await f.service.get()).toEqual({ enabled: false, modelRevision: 'unresolved', providerScope: 'unresolved' });
    await expect(f.service.assertEnabled()).rejects.toThrow('PROJECT_CONTEXT_DISABLED');
    const next = { enabled: true, modelRevision: 'revision', providerScope: 'tenant' };
    await f.service.put(next);
    expect(await new ProjectContextSettingsService(f.store as unknown as AppSettingsService).get()).toEqual({ enabled: true, modelRevision: 'unresolved', providerScope: 'unresolved' });
    await f.service.assertEnabled();
    expect(f.values.get('active_embedding_credential')).toBe('keep');
  });
  it.each([null, [], {}, { enabled: 'true', modelRevision: '', providerScope: '' },
    { enabled: true, modelRevision: 1, providerScope: '' }, { enabled: true, modelRevision: '', providerScope: 1 },
    { enabled: true, modelRevision: '', providerScope: '', extra: true }])('rejects invalid exact-key payload %j', async value => {
    const f = fixture(); await expect(f.service.put(value)).rejects.toThrow('INVALID_PROJECT_CONTEXT_SETTINGS');
    expect(f.store.set).not.toHaveBeenCalled();
  });
  it.each([
    { enabled: true, modelRevision: '', providerScope: 'local-user' },
    { enabled: false, modelRevision: ' ', providerScope: 'local-user' },
    { enabled: true, modelRevision: '\t\n', providerScope: 'local-user' },
    { enabled: true, modelRevision: ' revision', providerScope: 'local-user' },
    { enabled: true, modelRevision: 'revision ', providerScope: 'local-user' },
    { enabled: false, modelRevision: '', providerScope: '' },
    { enabled: true, modelRevision: 'revision', providerScope: ' \t' },
    { enabled: true, modelRevision: 'revision', providerScope: ' local-user' },
    { enabled: true, modelRevision: 'revision', providerScope: 'local-user ' },
    { enabled: true, modelRevision: 'r'.repeat(257), providerScope: 'local-user' },
    { enabled: false, modelRevision: 'r'.repeat(257), providerScope: 'local-user' },
    { enabled: true, modelRevision: 'revision', providerScope: 's'.repeat(257) },
    { enabled: false, modelRevision: '', providerScope: 'local-user', unknown: true },
  ])('rejects invalid identity bounds without persistence %j', async value => {
    const f = fixture(); await expect(f.service.put(value)).rejects.toThrow('INVALID_PROJECT_CONTEXT_SETTINGS');
    expect(f.store.set).not.toHaveBeenCalled();
  });
  it('accepts exact length bounds and empty revision only while disabled', async () => {
    const f = fixture();
    const maximum = { enabled: true, modelRevision: 'r'.repeat(256), providerScope: 's'.repeat(256) };
    expect(await f.service.put(maximum)).toEqual({ enabled: true, modelRevision: 'unresolved', providerScope: 'unresolved' });
    expect(await f.service.put({ enabled: false, modelRevision: '', providerScope: 'local-user' }))
      .toEqual({ enabled: false, modelRevision: 'unresolved', providerScope: 'unresolved' });
  });
  it('accepts enabled-only updates and persists only canonical enabled policy', async () => {
    const f = fixture();
    await f.service.put({ enabled: true });
    await f.service.assertEnabled();
    await f.service.put({ enabled: true, modelRevision: 'old-model', providerScope: 'old-scope' });
    await f.service.put({ enabled: false });
    expect(JSON.parse(f.values.get('project_context_settings')!)).toEqual({ enabled: false });
    expect(await f.service.get()).toEqual({ enabled: false, modelRevision: 'unresolved', providerScope: 'unresolved' });
  });
  it('enables old disabled settings with empty revision without merging invalid identity', async () => {
    const f = fixture();
    f.values.set('project_context_settings', JSON.stringify({ enabled: false, modelRevision: '', providerScope: 'local-user' }));
    expect((await f.service.get()).enabled).toBe(false);
    await f.service.put({ enabled: true });
    expect(JSON.parse(f.values.get('project_context_settings')!)).toEqual({ enabled: true });
    expect(await f.service.get()).toEqual({ enabled: true, modelRevision: 'unresolved', providerScope: 'unresolved' });
    await f.service.assertEnabled();
  });
});
