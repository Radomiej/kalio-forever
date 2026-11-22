import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSettingsService } from '../database/app-settings.service';
import type { CredentialsService } from '../modules/credentials/credentials.service';
import { DecisionSettingsService } from './decision-settings.service';

function setup() {
  const values = new Map<string, string>();
  const settings = { get: vi.fn(async (key: string) => values.get(key) ?? null), set: vi.fn(async (key: string, value: string) => { values.set(key, value); }) };
  const credentials = {
    findAll: vi.fn().mockResolvedValue([{ id: 'first', provider: 'openrouter', createdAt: 1 }, { id: 'second', provider: 'openrouter', createdAt: 2 }]),
    getProviderConfigForCredential: vi.fn(async (id: string) => ({ provider: 'openrouter', apiKey: id === 'first' ? '' : 'secret' })),
  };
  const service = new DecisionSettingsService(settings as unknown as AppSettingsService, credentials as unknown as CredentialsService);
  return { service, settings, credentials, values };
}

describe('DecisionSettingsService', () => {
  afterEach(() => vi.unstubAllEnvs());
  const native = { provider: 'ollama' as const, model: 'fixture:1', credentialId: null, endpoint: 'http://127.0.0.1:11434/api/chat' };
  it('isolates tools without rewriting the legacy goals record or resolving credentials', async () => {
    vi.stubEnv('KALIO_DEV_LOCAL_DECISIONS', 'true');
    const { service, values, settings, credentials } = setup();
    const legacy = JSON.stringify({ provider: 'custom', model: 'goal-judge', credentialId: null, endpoint: 'http://127.0.0.1:9090/decide' });
    values.set('decision.config', legacy);
    expect(await service.getConfig('tools')).toEqual(await service.getConfig());
    await service.updateConfig(native, 'tools');
    expect(settings.set).toHaveBeenCalledTimes(1);
    expect(settings.set).toHaveBeenCalledWith('decision.tools.config', JSON.stringify(native));
    expect(values.get('decision.config')).toBe(legacy);
    expect(await service.resolve()).toMatchObject({ protocol: 'jev-decisions', model: 'goal-judge' });
    expect(await service.resolve('tools')).toMatchObject({ protocol: 'ollama-chat', model: 'fixture:1' });
    expect(await service.resolve('tools')).not.toHaveProperty('apiKey');
    expect(credentials.getProviderConfigForCredential).not.toHaveBeenCalled();
  });
  it('keeps an explicit tool model when the goal model is changed', async () => {
    vi.stubEnv('KALIO_DEV_LOCAL_DECISIONS', 'true');
    const { service } = setup();
    await service.updateConfig(native, 'tools');
    const before = await service.resolve('tools');
    await service.updateConfig({ provider: 'custom', model: 'new-goal', endpoint: 'http://127.0.0.1:9090/decide', credentialId: null });
    expect(await service.getConfig('tools')).toEqual(native);
    expect(await service.resolve('tools')).toEqual(before);
    expect(await service.getConfig()).toHaveProperty('model', 'new-goal');
  });
  it.each(['', 'null', '{invalid', '{}'])('does not inherit goals when a present tools override is invalid: %s', async value => {
    const { service, values } = setup();
    values.set('decision.tools.config', value);
    values.set('decision.config', JSON.stringify({ provider: 'custom', model: 'goal', credentialId: null, endpoint: 'http://localhost:9090/decide' }));
    await expect(service.getConfig('tools')).rejects.toThrow();
  });
  it('does not attach a new revision to an old config across delayed reads', async () => {
    vi.stubEnv('KALIO_DEV_LOCAL_DECISIONS', 'true');
    const { service, settings, values } = setup();
    await service.updateConfig(native, 'tools');
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let reads = 0;
    settings.get.mockImplementation(async key => {
      const snapshot = values.get(key) ?? null;
      if (key === 'decision.tools.config' && ++reads === 2) await held;
      return snapshot;
    });
    const resolving = service.resolve('tools');
    const rejection = expect(resolving).rejects.toThrow('changed during resolution');
    await vi.waitFor(() => expect(reads).toBe(2));
    await service.updateConfig({ ...native, model: 'changed:1' }, 'tools');
    release();
    await rejection;
  });
  it('rejects native goal configuration and disabled native saves without writes', async () => {
    const { service, settings } = setup();
    vi.stubEnv('KALIO_DEV_LOCAL_DECISIONS', 'false');
    await expect(service.updateConfig(native, 'tools')).rejects.toThrow();
    vi.stubEnv('KALIO_DEV_LOCAL_DECISIONS', 'true');
    await expect(service.updateConfig(native)).rejects.toThrow();
    expect(settings.set).not.toHaveBeenCalled();
  });
  it.each(['https://remote.example/api/chat', 'http://127.0.0.1:11434/api/generate', 'http://user:pass@localhost/api/chat', 'http://localhost/api/chat?x=1', 'http://localhost/api/chat#x'])('rejects unsafe/native incompatible endpoint %s', async endpoint => {
    const { service, settings } = setup();
    await expect(service.updateConfig({ ...native, endpoint }, 'tools')).rejects.toThrow();
    expect(settings.set).not.toHaveBeenCalled();
  });
  it('rejects native credentials and invalid purposes before any write', async () => {
    const { service, settings } = setup();
    await expect(service.updateConfig({ ...native, credentialId: 'some-key' }, 'tools')).rejects.toThrow();
    await expect(service.updateConfig(native, 'other' as never)).rejects.toThrow();
    expect(settings.set).not.toHaveBeenCalled();
  });
  it('automatically selects the first usable OpenRouter credential without exposing its key', async () => {
    const { service } = setup();
    expect(await service.getConfig()).toMatchObject({ provider: 'openrouter', model: 'typesafe/jev-1.13', credentialId: 'second' });
    expect(JSON.stringify(await service.getConfig())).not.toContain('secret');
    expect(await service.resolve()).toMatchObject({ apiKey: 'secret', endpoint: 'https://openrouter.ai/api/alpha/decisions' });
  });

  it('persists native TypeSafe configuration and rejects mismatched credentials', async () => {
    const { service, credentials } = setup();
    await expect(service.updateConfig({ provider: 'typesafe', model: 'jev-1.13.0', credentialId: 'second', endpoint: '' })).rejects.toThrow();
    credentials.getProviderConfigForCredential.mockResolvedValue({ provider: 'typesafe', apiKey: 'native-key' });
    await service.updateConfig({ provider: 'typesafe', model: 'jev-1.13.0', credentialId: 'second', endpoint: '' });
    expect(await service.resolve()).toMatchObject({ model: 'jev-1.13.0', endpoint: 'https://api.typesafe.ai/v1/systemone', apiKey: 'native-key' });
  });

  it('supports a keyless local Decisions server and validates remote endpoint safety', async () => {
    const { service } = setup();
    await service.updateConfig({ provider: 'custom', model: 'local-decision', credentialId: null, endpoint: 'http://127.0.0.1:9090/decide' });
    expect(await service.resolve()).toMatchObject({ apiKey: '', model: 'local-decision', endpoint: 'http://127.0.0.1:9090/decide' });
    for (const endpoint of ['http://remote.example/decide', 'https://user:pass@remote.example/decide', 'https://remote.example/decide?key=secret']) {
      await expect(service.updateConfig({ provider: 'custom', model: 'local', credentialId: null, endpoint })).rejects.toThrow();
    }
  });

  it('does not replace an explicitly selected missing credential with another secret', async () => {
    const { service, values, credentials } = setup();
    values.set('decision.config', JSON.stringify({ provider: 'openrouter', model: 'typesafe/jev-1.13', credentialId: 'deleted', endpoint: '' }));
    credentials.getProviderConfigForCredential.mockResolvedValue(null as never);
    await expect(service.resolve()).rejects.toThrow();
  });
  it('uses native TypeSafe when no usable OpenRouter exists, but never overrides a saved provider', async () => {
    const { service, credentials, values } = setup();
    credentials.findAll.mockResolvedValue([{ id: 'native', provider: 'typesafe', createdAt: 1 }]);
    credentials.getProviderConfigForCredential.mockResolvedValue({ provider: 'typesafe', apiKey: 'native-key' });
    expect(await service.getConfig()).toMatchObject({ provider: 'typesafe', model: 'jev-1.13.0', credentialId: 'native' });
    values.set('decision.config', JSON.stringify({ provider: 'openrouter', credentialId: null, model: 'typesafe/jev-1.13', endpoint: '' }));
    expect(await service.getConfig()).toMatchObject({ provider: 'openrouter', credentialId: null });
    await expect(service.resolve()).rejects.toThrow('Add a compatible provider credential');
  });

  it('rejects malformed configurations before persisting anything', async () => {
    const { service, settings } = setup();
    const config = { provider: 'openrouter', credentialId: null, model: 'typesafe/jev-1.13', endpoint: '' };
    for (const input of [null, [], { ...config, provider: 'chat' }, { ...config, model: '' }, { ...config, credentialId: 42 }, { ...config, endpoint: null }]) {
      await expect(service.updateConfig(input as never)).rejects.toThrow();
    }
    expect(settings.set).not.toHaveBeenCalled();
  });

});
